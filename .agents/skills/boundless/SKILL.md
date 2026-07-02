---
name: Boundless
description: Use when building ZK applications, requesting proofs from the decentralized market, running a prover node, or integrating verifiable compute into smart contracts. Boundless decouples execution from consensus using zero-knowledge proofs, enabling developers to bypass gas limits and scale computation across any blockchain.
metadata:
    mintlify-proj: boundless
    version: "1.0"
---

# Boundless Skill

## Product Summary

Boundless is a decentralized protocol that brings zero-knowledge proofs to every blockchain by decoupling execution from consensus. Developers submit proof requests to a permissionless market where provers compete to fulfill them, earning rewards. The protocol uses a reverse Dutch auction mechanism to match requestors with provers, aggregates proofs for efficient onchain verification, and enables applications to offload computation without compromising security.

**Key files and commands:**
- SDK: `boundless-market` Rust crate for submitting requests and managing proofs
- CLI: `boundless` command-line tool for prover setup, deposits, benchmarking, and reward claims
- Bento: Docker Compose proving stack (local proving infrastructure)
- Broker: Market interaction service that bids on requests and submits proofs onchain
- Configuration: `broker.toml` for prover settings, `.env.broker` for environment variables
- Primary docs: https://docs.boundless.network

## When to Use

Reach for this skill when:
- **Developers** need to request ZK proofs for guest programs (Rust programs compiled for RISC Zero zkVM)
- **Developers** want to verify proofs onchain in smart contracts using Merkle inclusion proofs or Groth16 SNARKs
- **Developers** are building Steel applications (EVM coprocessor for offchain execution with onchain verification)
- **Developers** need to configure auction parameters (pricing, timeouts, collateral) for proof requests
- **Provers** are setting up a proving node with GPU hardware to earn rewards
- **Provers** need to configure the Broker for market bidding, pricing, and proof submission
- **Provers** are enabling ZK mining to earn $ZKC rewards for verifiable work
- **Developers** need to integrate Boundless with existing smart contracts or rollups (Kailua)

## Quick Reference

### SDK Workflow (Developers)

| Task | Command/Code |
|------|--------------|
| Initialize client | `Client::builder().with_rpc_url(url).with_private_key(key).build().await?` |
| Upload program | `client.upload_program(&fs::read("guest.bin")?).await?` |
| Create request | `client.new_request().with_program(ELF).with_stdin(input)` |
| Submit request | `client.submit(request).await?` returns `(request_id, expires_at)` |
| Wait for proof | `client.wait_for_request_fulfillment(request_id, Duration::from_secs(10), expires_at).await?` |
| Verify onchain | `verifier.verify(seal, imageId, sha256(journal))` in Solidity |

### Prover Setup Commands

| Task | Command |
|------|---------|
| Install Boundless CLI | `cargo install --locked --git https://github.com/boundless-xyz/boundless boundless-cli --branch release-2.0 --bin boundless` |
| Install Bento CLI | `cargo install --locked --git https://github.com/boundless-xyz/boundless bento-client --branch release-2.0 --bin bento_cli` |
| Run test proof | `RUST_LOG=info bento_cli -c 32` |
| Generate prover config | `boundless prover generate-config` (interactive wizard) |
| Deposit collateral | `boundless prover deposit-collateral 50` |
| Check collateral balance | `boundless prover balance-collateral [address]` |
| Start prover | `just prover` (runs Bento + Broker) |
| View prover logs | `just prover logs` |
| Stop prover | `just prover down` |
| Clean prover state | `just prover clean` |
| Benchmark Bento | `boundless prover benchmark --request-ids <IDS>` |

### Broker Configuration (broker.toml)

| Setting | Purpose | Example |
|---------|---------|---------|
| `[market] min_mcycle_price` | Minimum price per million cycles to bid | `"0.02 USD"` or `"0.00002 ETH"` |
| `[market] max_collateral` | Maximum ZKC to lock per request | `"200 ZKC"` or `"100 USD"` |
| `[market] peak_prove_khz` | Estimated proving capacity (from benchmarking) | `500` |
| `[market] max_mcycle_limit` | Skip requests exceeding this cycle count | `50000000` |
| `[market] max_concurrent_proofs` | Parallel proofs to process | `2` |
| `[prover] proof_retry_count` | Retries for failed proofs | `3` |
| `[batcher] batch_max_time` | Max seconds before publishing batch | `60` |
| `[batcher] min_batch_size` | Minimum proofs before publishing | `5` |

### Storage Providers (Environment Variables)

| Provider | Required Variables |
|----------|-------------------|
| Pinata (IPFS) | `PINATA_JWT="..."` |
| S3 | `S3_BUCKET="..."`, `AWS_ACCESS_KEY_ID="..."`, `AWS_SECRET_ACCESS_KEY="..."` |
| GCS | `GCS_BUCKET="..."`, `GOOGLE_APPLICATION_CREDENTIALS="..."` |
| None (pre-upload) | Provide `program_url` and `input_url` directly |

## Decision Guidance

### When to Use Aggregated vs Groth16 Proofs

| Scenario | Use Aggregated | Use Groth16 |
|----------|---|---|
| Multiple requests in batch | ✓ | |
| Single request, cost-sensitive | | ✓ |
| Frequent onchain verification | | ✓ |
| Amortizing verification gas | ✓ | |
| Merkle inclusion proof acceptable | ✓ | |
| Need SNARK proof | | ✓ |

### When to Use Onchain vs Offchain Submission

| Scenario | Onchain | Offchain |
|----------|---------|----------|
| Censorship-resistance required | ✓ | |
| Lower gas cost preferred | | ✓ |
| Requires deposit in market | | ✓ |
| Public immutability needed | ✓ | |
| Default (tries offchain first) | `client.submit()` | `client.submit()` |

### When to Adjust Auction Parameters

| Condition | Action |
|-----------|--------|
| Requests not locking | Increase `max_price` or decrease `lock_timeout` |
| Requests locking slowly | Decrease `ramp_up_start` or increase `min_price` |
| Requests expiring unfulfilled | Increase `timeout` or `lock_collateral` |
| Prover slashing risk | Increase `lock_timeout` or decrease `lock_collateral` |
| Cost optimization | Decrease `max_price` or `lock_collateral` |

## Workflow

### Developer: Submit and Verify a Proof

1. **Prepare the guest program**: Write Rust code for RISC Zero zkVM, compile to ELF binary
2. **Set environment variables**: `RPC_URL`, `PRIVATE_KEY`, storage provider credentials (`PINATA_JWT` or S3/GCS)
3. **Initialize SDK client**: `Client::builder().with_rpc_url(rpc_url).with_private_key(key).build().await?`
4. **Create request**: `client.new_request().with_program(ELF).with_stdin(input).with_offer(params)`
5. **Submit request**: `let (request_id, expires_at) = client.submit(request).await?`
6. **Wait for fulfillment**: `let fulfillment = client.wait_for_request_fulfillment(request_id, Duration::from_secs(10), expires_at).await?`
7. **Extract proof**: `let (journal, seal) = (fulfillment.data()?, fulfillment.seal)`
8. **Verify onchain**: Call smart contract with `seal` and `journal` to verify proof
9. **Use result**: Application logic proceeds based on verified computation

### Prover: Set Up and Run a Proving Node

1. **Verify hardware**: Minimum 16 CPU threads, 32GB RAM, 200GB SSD, 1+ NVIDIA GPU (8GB+ VRAM)
2. **Clone Boundless repo**: `git clone https://github.com/boundless-xyz/boundless && git checkout release-2.0`
3. **Install dependencies**: `sudo ./scripts/setup.sh` (Docker, Docker Nvidia support)
4. **Set environment variables**: `PROVER_PRIVATE_KEY`, `PROVER_RPC_URL` (or per-chain: `PROVER_RPC_URL_8453`, `PROVER_RPC_URL_167000`)
5. **Test Bento**: `just bento` then `RUST_LOG=info bento_cli -c 32` to verify proving works
6. **Generate config**: `boundless prover generate-config` (interactive wizard derives optimal settings)
7. **Deposit collateral**: `boundless prover deposit-collateral 50` (ZKC tokens)
8. **Start prover**: `just prover` (runs Bento + Broker together)
9. **Monitor logs**: `just prover logs` to watch for locked requests and proof submissions
10. **Optimize**: Adjust `broker.toml` settings based on market conditions and hardware performance

### Prover: Enable ZK Mining

1. **Stake ZKC**: Deposit ZKC to become eligible for mining rewards
2. **Set reward address**: Export `REWARD_ADDRESS` environment variable in `.env.broker`
3. **Generate work proofs**: Proofs generated with `REWARD_ADDRESS` set automatically create work proofs
4. **Prepare mining**: Run `boundless rewards prepare-mining` to aggregate work proofs for the epoch
5. **Submit work proof**: Run `boundless rewards submit-mining` to post aggregated proof onchain
6. **Wait for epoch finalization**: Current epoch must finalize before claiming
7. **Claim rewards**: Run `boundless rewards claim-mining-rewards` to collect $ZKC earnings

## Common Gotchas

- **Proof request expires before fulfillment**: Increase `timeout` parameter or lower `max_price` to attract faster provers. Default timeout is conservative; adjust based on program cycle count.
- **Prover gets slashed**: `lock_timeout` was too short for proving time. Use the time calculator to estimate proving time (1MHz average) and set `lock_timeout` to 1.25x that estimate.
- **Requests not locking**: `max_price` is too low relative to market conditions. Start with higher prices and decrease incrementally. Use USD-denominated pricing for stability across ETH volatility.
- **Collateral balance insufficient**: Broker will skip requests if `max_collateral` is exceeded. Deposit more ZKC or lower `max_collateral` in `broker.toml`.
- **Bento not running**: Broker requires Bento to be running. Start with `just bento` first, then `just prover` in a separate terminal or use `just prover` which starts both.
- **RPC rate limits**: Free RPC tiers are insufficient for production provers. Use paid plans (Alchemy, Quicknode, dRPC). `ChainMonitorV2` reduces RPC load but still requires reliable endpoints.
- **Segment size too large**: GPU VRAM exhaustion. Reduce `SEGMENT_SIZE` in `.env.broker` or compose file. Use performance optimization page to find max segment size for your GPU.
- **Journal too large**: Journals > 10KB are rejected by provers (expensive onchain). Use `ClaimDigestMatch` predicate and store journals offchain if needed.
- **Program file too large**: Programs > 50MB are rejected. Optimize guest code or split into smaller programs.
- **Inline inputs too large**: Large inline inputs increase gas costs. Use storage provider URLs for inputs > 1KB.
- **Missing image URL**: Provers cannot download program if URL is inaccessible. Verify URL is public and accessible before submitting request.
- **Proof verification fails**: Journal mismatch or wrong image ID. Ensure journal encoding matches expected format and image ID is correct in contract.

## Verification Checklist

Before submitting work:

- [ ] **Developers**: Guest program compiles without panics and executes successfully locally
- [ ] **Developers**: Environment variables set: `RPC_URL`, `PRIVATE_KEY`, storage credentials
- [ ] **Developers**: Auction parameters configured: `min_price`, `max_price`, `timeout`, `lock_timeout`, `lock_collateral`
- [ ] **Developers**: Program URL is publicly accessible and provers can download it
- [ ] **Developers**: Journal size < 10KB (or using `ClaimDigestMatch` predicate for larger journals)
- [ ] **Developers**: Proof verification contract has correct `imageId` and journal encoding
- [ ] **Provers**: Hardware meets minimum requirements (16 CPU, 32GB RAM, 200GB SSD, 1+ GPU)
- [ ] **Provers**: Bento test proof succeeds: `RUST_LOG=info bento_cli -c 32`
- [ ] **Provers**: `broker.toml` generated via `boundless prover generate-config`
- [ ] **Provers**: Collateral deposited: `boundless prover balance-collateral` shows sufficient ZKC
- [ ] **Provers**: RPC URL is reliable and supports required methods (`eth_getBlockReceipts` for ChainMonitorV2)
- [ ] **Provers**: `peak_prove_khz` set accurately from benchmarking: `boundless prover benchmark --request-ids <IDS>`
- [ ] **Provers**: Broker logs show "Starting pipeline for chain" for each configured chain
- [ ] **Provers**: No locked orders with pending proofs before upgrading or restarting

## Resources

**Comprehensive navigation**: https://docs.boundless.network/llms.txt

**Critical documentation pages**:
1. [Proof Lifecycle](/developers/proof-lifecycle) — End-to-end flow from request to verification
2. [Broker Configuration & Operation](/provers/broker) — All broker.toml settings and optimization
3. [Request a Proof](/developers/tutorials/request) — SDK usage, storage providers, offer configuration

---

> For additional documentation and navigation, see: https://docs.boundless.network/llms.txt