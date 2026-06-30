#![no_std]

//! Gatekeeper contract.
//!
//! Registers anonymous membership commitments per repo group, after the
//! backend relayer has verified a contributor's proof off-chain (the Option A
//! hybrid model from plan.md §6). On-chain logic is intentionally minimal:
//! bookkeeping of which commitments belong to which repo group, plus an
//! auth gate so only the trusted relayer can register members.

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, BytesN, Env, Symbol};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAuthorized = 3,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    /// Singleton config (admin + relayer).
    Config,
    /// Membership flag for (repo_id, commitment).
    Member(Symbol, BytesN<32>),
}

#[contracttype]
#[derive(Clone)]
pub struct Config {
    pub admin: Address,
    pub relayer: Address,
}

#[contract]
pub struct GatekeeperContract;

#[contractimpl]
impl GatekeeperContract {
    /// One-time setup: stores the admin and the trusted relayer address that
    /// is allowed to call `register_member`.
    pub fn initialize(env: Env, admin: Address, relayer: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::Config, &Config { admin, relayer });
        Ok(())
    }

    /// Registers a new anonymous member commitment under a repo group.
    /// Restricted to the trusted relayer address set at init.
    pub fn register_member(
        env: Env,
        caller: Address,
        repo_id: Symbol,
        commitment: BytesN<32>,
    ) -> Result<(), Error> {
        let config = Self::config(&env)?;
        caller.require_auth();
        if caller != config.relayer {
            return Err(Error::NotAuthorized);
        }
        env.storage()
            .persistent()
            .set(&DataKey::Member(repo_id, commitment), &true);
        Ok(())
    }

    /// Read-only. Confirms a commitment belongs to a repo's contributor group.
    /// Returns `false` (never panics) for unknown repo/commitment.
    pub fn is_member(env: Env, repo_id: Symbol, commitment: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Member(repo_id, commitment))
            .unwrap_or(false)
    }

    /// Admin-only: rotate the trusted relayer address.
    pub fn set_relayer(env: Env, admin: Address, new_relayer: Address) -> Result<(), Error> {
        let mut config = Self::config(&env)?;
        admin.require_auth();
        if admin != config.admin {
            return Err(Error::NotAuthorized);
        }
        config.relayer = new_relayer;
        env.storage().instance().set(&DataKey::Config, &config);
        Ok(())
    }

    /// Read-only: returns the current relayer address.
    pub fn relayer(env: Env) -> Result<Address, Error> {
        Ok(Self::config(&env)?.relayer)
    }

    fn config(env: &Env) -> Result<Config, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(Error::NotInitialized)
    }
}

mod test;
