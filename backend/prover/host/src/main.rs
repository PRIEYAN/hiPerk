use std::env;
use std::net::SocketAddr;

use anyhow::{anyhow, Context, Result};
use axum::{http::StatusCode, response::IntoResponse, routing::post, Json, Router};
use methods::{PROVE_MERGE_ELF, PROVE_MERGE_ID};
use risc0_zkvm::{default_prover, ExecutorEnv};
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
    /// Full bincode-serialized `Receipt` (hex), re-verifiable via
    /// `receipt.verify(PROVE_MERGE_ID)`. Not a compact on-chain SNARK seal —
    /// there's no on-chain verifier target in local-proving mode.
    receipt_hex: String,
    commitment: String,
    nullifier: String,
    repo_id: String,
}

#[derive(Serialize)]
struct ErrorBody {
    error: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    let app = Router::new().route("/prove", post(prove_handler));

    let addr: SocketAddr = env::var("PROVER_LISTEN_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:8080".to_string())
        .parse()
        .context("invalid PROVER_LISTEN_ADDR")?;

    println!("prover host listening on {addr} (local RISC Zero proving, no external prover market)");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn prove_handler(Json(body): Json<ProveRequest>) -> impl IntoResponse {
    // `default_prover()` runs proving synchronously on the CPU; offload it to
    // a blocking thread so it doesn't stall the async runtime.
    match tokio::task::spawn_blocking(move || run_proof(body)).await {
        Ok(Ok(resp)) => (StatusCode::OK, Json(resp)).into_response(),
        Ok(Err(e)) => (
            StatusCode::BAD_REQUEST,
            Json(ErrorBody { error: e.to_string() }),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorBody { error: format!("proving task panicked: {e}") }),
        )
            .into_response(),
    }
}

fn run_proof(body: ProveRequest) -> Result<ProveResponse> {
    let input = GuestInput {
        raw_email: body.raw_email,
        repo_url: body.repo_url,
        contributor_secret: body.contributor_secret,
    };

    let env = ExecutorEnv::builder()
        .write(&input)
        .context("failed to write guest input")?
        .build()
        .context("failed to build executor env")?;

    // Proves locally on this machine's CPU — no external prover market, no
    // wallet, no third-party dependency. Set RISC0_DEV_MODE=1 while iterating
    // to skip real proving and get a fast, unproven receipt for testing.
    let receipt = default_prover()
        .prove(env, PROVE_MERGE_ELF)
        .context("local proving failed")?
        .receipt;

    receipt
        .verify(PROVE_MERGE_ID)
        .context("receipt failed verification against prove-merge image id")?;

    let output: GuestOutput = receipt
        .journal
        .decode()
        .context("failed to decode guest journal")?;
    if !output.pr_merged {
        return Err(anyhow!("proof did not confirm a merged PR"));
    }

    // Locally there's no on-chain verifier expecting a compact SNARK seal, so
    // the whole `Receipt` (which contains the seal via `receipt.inner`) is
    // serialized wholesale — this is the artifact a caller would re-verify
    // with `receipt.verify(PROVE_MERGE_ID)`.
    let receipt_bytes =
        bincode::serialize(&receipt).context("failed to serialize receipt")?;

    Ok(ProveResponse {
        journal_hex: hex::encode(&receipt.journal.bytes),
        receipt_hex: hex::encode(receipt_bytes),
        commitment: hex::encode(output.commitment),
        nullifier: hex::encode(output.nullifier),
        repo_id: output.repo_id,
    })
}
