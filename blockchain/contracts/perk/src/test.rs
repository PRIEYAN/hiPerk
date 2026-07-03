#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env, String, Symbol,
};

// Pull in the real Gatekeeper contract for cross-contract tests instead of the
// WASM import (which only resolves at build time).
use ::gatekeeper::{GatekeeperContract, GatekeeperContractClient};

struct Setup<'a> {
    env: Env,
    perk: PerkContractClient<'a>,
    gk: GatekeeperContractClient<'a>,
    relayer: Address,
    admin: Address,
    token: Address,
    token_admin: StellarAssetClient<'a>,
}

fn setup<'a>() -> Setup<'a> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let relayer = Address::generate(&env);

    // Deploy gatekeeper.
    let gk_id = env.register(GatekeeperContract, ());
    let gk = GatekeeperContractClient::new(&env, &gk_id);
    gk.initialize(&admin, &relayer);

    // Deploy a test token (SAC) with `admin` as issuer.
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token = sac.address();
    let token_admin = StellarAssetClient::new(&env, &token);

    // Deploy perk and wire it to the gatekeeper.
    let perk_id = env.register(PerkContract, ());
    let perk = PerkContractClient::new(&env, &perk_id);
    perk.initialize(&admin, &relayer, &gk_id);

    Setup {
        env,
        perk,
        gk,
        relayer,
        admin,
        token,
        token_admin,
    }
}

fn b32(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

fn create_and_fund(s: &Setup, module_id: &Symbol, repo_id: &String, fund: i128) {
    s.perk.create_module(
        &s.admin,
        module_id,
        repo_id,
        &s.token,
        &Symbol::new(&s.env, "manual"),
    );
    // Mint to the funder, then fund the pool.
    s.token_admin.mint(&s.admin, &fund);
    s.perk.fund_module(&s.admin, module_id, &fund);
}

#[test]
fn create_fund_and_balance() {
    let s = setup();
    let module_id = Symbol::new(&s.env, "mod_a");
    let repo_id = String::from_str(&s.env, "stellar/repo-a");
    create_and_fund(&s, &module_id, &repo_id, 1000);

    let pool = s.perk.get_module(&module_id);
    assert_eq!(pool.balance, 1000);
    assert_eq!(pool.repo_id, repo_id);
}

#[test]
fn list_modules_returns_all_created() {
    let s = setup();

    // Empty before any create.
    assert_eq!(s.perk.list_modules().len(), 0);

    let m1 = Symbol::new(&s.env, "mod_l1");
    let m2 = Symbol::new(&s.env, "mod_l2");
    let m3 = Symbol::new(&s.env, "mod_l3");
    // Full slash-containing repo names round-trip losslessly as String.
    create_and_fund(&s, &m1, &String::from_str(&s.env, "org/one"), 100);
    create_and_fund(&s, &m2, &String::from_str(&s.env, "org/two"), 200);
    create_and_fund(&s, &m3, &String::from_str(&s.env, "org/three"), 0);

    let all = s.perk.list_modules();
    assert_eq!(all.len(), 3);
    // Creation order preserved.
    assert_eq!(all.get(0).unwrap().module_id, m1);
    assert_eq!(all.get(1).unwrap().module_id, m2);
    assert_eq!(all.get(2).unwrap().module_id, m3);
    // Full repo names and live balances are present in the shared list.
    assert_eq!(all.get(0).unwrap().repo_id, String::from_str(&s.env, "org/one"));
    assert_eq!(all.get(1).unwrap().balance, 200);
}

#[test]
fn claim_happy_path() {
    let s = setup();
    let module_id = Symbol::new(&s.env, "mod_b");
    let repo_id = String::from_str(&s.env, "org/repo-b");
    create_and_fund(&s, &module_id, &repo_id, 1000);

    let commitment = b32(&s.env, 7);
    let nullifier = b32(&s.env, 8);
    s.gk.register_member(&s.relayer, &repo_id, &commitment);

    let payout = Address::generate(&s.env);
    s.perk
        .claim(&s.relayer, &module_id, &commitment, &nullifier, &payout, &400);

    assert_eq!(s.perk.get_module(&module_id).balance, 600);
    let tok = TokenClient::new(&s.env, &s.token);
    assert_eq!(tok.balance(&payout), 400);
}

#[test]
fn claim_double_nullifier_fails() {
    let s = setup();
    let module_id = Symbol::new(&s.env, "mod_c");
    let repo_id = String::from_str(&s.env, "org/repo-c");
    create_and_fund(&s, &module_id, &repo_id, 1000);

    let commitment = b32(&s.env, 1);
    let nullifier = b32(&s.env, 2);
    s.gk.register_member(&s.relayer, &repo_id, &commitment);

    let payout = Address::generate(&s.env);
    s.perk
        .claim(&s.relayer, &module_id, &commitment, &nullifier, &payout, &100);

    let res = s
        .perk
        .try_claim(&s.relayer, &module_id, &commitment, &nullifier, &payout, &100);
    assert_eq!(res, Err(Ok(Error::NullifierUsed)));
}

#[test]
fn claim_non_member_fails() {
    let s = setup();
    let module_id = Symbol::new(&s.env, "mod_d");
    let repo_id = String::from_str(&s.env, "org/repo-d");
    create_and_fund(&s, &module_id, &repo_id, 1000);

    let commitment = b32(&s.env, 3); // never registered
    let nullifier = b32(&s.env, 4);
    let payout = Address::generate(&s.env);

    let res = s
        .perk
        .try_claim(&s.relayer, &module_id, &commitment, &nullifier, &payout, &100);
    assert_eq!(res, Err(Ok(Error::NotAMember)));
}

#[test]
fn claim_exceeding_balance_fails() {
    let s = setup();
    let module_id = Symbol::new(&s.env, "mod_e");
    let repo_id = String::from_str(&s.env, "org/repo-e");
    create_and_fund(&s, &module_id, &repo_id, 100);

    let commitment = b32(&s.env, 5);
    let nullifier = b32(&s.env, 6);
    s.gk.register_member(&s.relayer, &repo_id, &commitment);
    let payout = Address::generate(&s.env);

    let res = s
        .perk
        .try_claim(&s.relayer, &module_id, &commitment, &nullifier, &payout, &500);
    assert_eq!(res, Err(Ok(Error::InsufficientBalance)));
}

#[test]
fn claim_from_non_relayer_fails() {
    let s = setup();
    let module_id = Symbol::new(&s.env, "mod_f");
    let repo_id = String::from_str(&s.env, "org/repo-f");
    create_and_fund(&s, &module_id, &repo_id, 1000);

    let commitment = b32(&s.env, 5);
    let nullifier = b32(&s.env, 6);
    s.gk.register_member(&s.relayer, &repo_id, &commitment);

    let stranger = Address::generate(&s.env);
    let payout = Address::generate(&s.env);
    let res = s
        .perk
        .try_claim(&stranger, &module_id, &commitment, &nullifier, &payout, &100);
    assert_eq!(res, Err(Ok(Error::NotAuthorized)));
}
