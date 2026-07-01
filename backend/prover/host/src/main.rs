use std::env;
use std::net::SocketAddr;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use axum::{extract::State, http::StatusCode, response::IntoResponse, routing::post, Json, Router};
use boundless_market::Client;
use methods::{PROVE_MERGE_ELF, PROVE_MERGE_ID};
use serde::{Deserialize, Serialize};

/// Private guest input — mirrors `methods/guest/src/main.rs::GuestInput`.
#[derive(Serialize)]
struct GuestInput {
    raw_email: String,
    repo_url: String,
    contributor_secret: String,
}

/// Public guest journal output — mirrors `GuestOutput` in the guest program.
#[derive(Deserialize)]
struct GuestOutput {
    repo_id: String,
    commitment: [u8; 32],
    nullifier: [u8; 32],
    pr_merged: bool,
}

#[derive(Deserialize)]
struct ProveRequest {
    raw_email: String,
    repo_url: String,
    contributor_secret: String,
}

#[derive(Serialize)]
struct ProveResponse {
    journal_hex: String,
    seal_hex: String,
    commitment: String,
    nullifier: String,
    repo_id: String,
}

#[derive(Serialize)]
struct ErrorBody {
    error: String,
}

#[derive(Clone)]
struct AppState {
    client: Client,
}

#[tokio::main]
async fn main() -> Result<()> {
    let rpc_url = env::var("BOUNDLESS_RPC_URL")
        .context("BOUNDLESS_RPC_URL not set (Ethereum-compatible RPC for the Boundless market)")?
        .parse()
        .context("BOUNDLESS_RPC_URL is not a valid URL")?;
    let private_key = env::var("BOUNDLESS_PRIVATE_KEY")
        .context("BOUNDLESS_PRIVATE_KEY not set (funds/signs Boundless proof requests)")?;

    // NOTE: `.with_deployment(...)` may be required here to target a specific
    // Boundless Market deployment (chain + contract addresses) rather than a
    // default — confirm against current `boundless-market` docs once
    // https://docs.beboundless.xyz is reachable again (its TLS cert was
    // expired at the time this was written).
    let client = Client::builder()
        .with_rpc_url(rpc_url)
        .with_private_key_str(&private_key)
        .build()
        .await
        .context("failed to build Boundless client")?;

    let state = AppState { client };

    let app = Router::new()
        .route("/prove", post(prove_handler))
        .with_state(state);

    let addr: SocketAddr = env::var("PROVER_LISTEN_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:8080".to_string())
        .parse()
        .context("invalid PROVER_LISTEN_ADDR")?;

    println!("prover host listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn prove_handler(
    State(state): State<AppState>,
    Json(body): Json<ProveRequest>,
) -> impl IntoResponse {
    match run_proof(&state, body).await {
        Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(ErrorBody { error: e.to_string() }),
        )
            .into_response(),
    }
}

async fn run_proof(state: &AppState, body: ProveRequest) -> Result<ProveResponse> {
    let input = GuestInput {
        raw_email: body.raw_email,
        repo_url: body.repo_url,
        contributor_secret: body.contributor_secret,
    };
    // Must match the guest's `env::read()`, which deserializes with
    // `risc0_zkvm::serde` (postcard), not JSON.
    let input_bytes =
        risc0_zkvm::serde::to_vec(&input).context("failed to serialize guest input")?;
    let input_bytes: Vec<u8> = bytemuck::cast_slice(&input_bytes).to_vec();

    // Submit the proof request to the Boundless market. `submit` picks
    // reasonable default offer/pricing terms; if requests aren't being
    // picked up by provers, configure explicit offer params on the request
    // builder (min/max price, timeout) — see the `OfferParams` type in
    // `boundless_market::request_builder`.
    let request = state
        .client
        .new_request()
        .with_program(PROVE_MERGE_ELF)
        .with_stdin(&input_bytes);

    let (request_id, expires_at) = state
        .client
        .submit(request)
        .await
        .context("failed to submit proof request to Boundless")?;

    let fulfillment = state
        .client
        .wait_for_request_fulfillment(request_id, Duration::from_secs(5), expires_at)
        .await
        .context("proof request was not fulfilled")?;

    let seal_hex = hex::encode(&fulfillment.seal);

    // `fulfillment.data()` decodes to `FulfillmentDataImageIdAndJournal`,
    // which exposes `imageId: FixedBytes<32>` and `journal: Bytes` as public
    // fields (not accessor methods) — confirm against `boundless-market`
    // docs if this shape changes in a future release.
    let data = fulfillment
        .data()
        .context("fulfillment missing decodable data")?;

    if <[u8; 32]>::from(data.imageId) != PROVE_MERGE_ID {
        return Err(anyhow!("fulfillment image id does not match prove-merge guest"));
    }

    let journal_bytes = data.journal.to_vec();
    // The guest commits its output via `risc0_zkvm::guest::env::commit`, which
    // serializes with `risc0_zkvm::serde` (postcard), not JSON.
    let output: GuestOutput = risc0_zkvm::serde::from_slice(&journal_bytes)
        .context("failed to decode guest journal")?;
    if !output.pr_merged {
        return Err(anyhow!("proof did not confirm a merged PR"));
    }

    Ok(ProveResponse {
        journal_hex: hex::encode(&journal_bytes),
        seal_hex,
        commitment: hex::encode(output.commitment),
        nullifier: hex::encode(output.nullifier),
        repo_id: output.repo_id,
    })
}
