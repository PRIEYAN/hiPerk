#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String};

fn setup() -> (Env, GatekeeperContractClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(GatekeeperContract, ());
    let client = GatekeeperContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let relayer = Address::generate(&env);
    client.initialize(&admin, &relayer);
    (env, client, admin, relayer)
}

fn commitment(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

#[test]
fn initialize_register_and_is_member() {
    let (env, client, _admin, relayer) = setup();
    let repo = String::from_str(&env, "stellar/stellar-sdk");
    let c = commitment(&env, 1);

    assert_eq!(client.is_member(&repo, &c), false);
    client.register_member(&relayer, &repo, &c);
    assert_eq!(client.is_member(&repo, &c), true);
}

#[test]
#[should_panic]
fn reject_register_from_non_relayer() {
    let (env, client, _admin, _relayer) = setup();
    // Force only the impersonated caller's auth so the relayer check fails.
    env.set_auths(&[]);
    let stranger = Address::generate(&env);
    let repo = String::from_str(&env, "stellar/stellar-sdk");
    let c = commitment(&env, 2);
    client.register_member(&stranger, &repo, &c);
}

#[test]
fn is_member_false_for_unknown() {
    let (env, client, _admin, _relayer) = setup();
    let repo = String::from_str(&env, "unknown/repo");
    let c = commitment(&env, 9);
    assert_eq!(client.is_member(&repo, &c), false);
}

#[test]
fn relayer_rotation() {
    let (env, client, admin, old_relayer) = setup();
    let new_relayer = Address::generate(&env);
    let repo = String::from_str(&env, "stellar/freighter");
    let c = commitment(&env, 3);

    client.set_relayer(&admin, &new_relayer);
    assert_eq!(client.relayer(), new_relayer);

    // New relayer can register.
    client.register_member(&new_relayer, &repo, &c);
    assert_eq!(client.is_member(&repo, &c), true);

    // Old relayer is no longer the trusted relayer.
    let c2 = commitment(&env, 4);
    let res = client.try_register_member(&old_relayer, &repo, &c2);
    assert_eq!(res, Err(Ok(Error::NotAuthorized)));
}

#[test]
fn cannot_reinitialize() {
    let (_env, client, admin, relayer) = setup();
    let res = client.try_initialize(&admin, &relayer);
    assert_eq!(res, Err(Ok(Error::AlreadyInitialized)));
}
