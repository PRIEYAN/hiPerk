#![no_std]

//! Perk / Module contract.
//!
//! Holds a funded reward pool per module, validates anonymous claims against
//! the Gatekeeper contract (cross-contract `is_member` call), prevents
//! double-claiming via nullifiers, and pays out from the pool using the
//! Stellar token interface (SAC). The relayer (backend) is the trusted caller
//! for `claim`, acting on behalf of the contributor after off-chain approval.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, BytesN, Env, String,
    Symbol, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAuthorized = 3,
    ModuleExists = 4,
    ModuleNotFound = 5,
    NotAMember = 6,
    NullifierUsed = 7,
    InsufficientBalance = 8,
    InvalidAmount = 9,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    /// Singleton config (admin + relayer + gatekeeper address).
    Config,
    /// ModulePool keyed by module_id.
    Module(Symbol),
    /// Nullifier-spent flag keyed by (module_id, nullifier).
    Nullifier(Symbol, BytesN<32>),
    /// On-chain index of every module_id ever created, in creation order.
    /// Soroban cannot enumerate storage keys, so this vector IS the "list all
    /// modules" capability — it lets any client (on any machine) read the full
    /// module set live from the contract, with no off-chain index required.
    ModuleIndex,
}

#[contracttype]
#[derive(Clone)]
pub struct Config {
    pub admin: Address,
    pub relayer: Address,
    pub gatekeeper: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct ModulePool {
    pub module_id: Symbol,
    /// Full human-readable repo id (e.g. "stellar/smoke-test"), stored as a
    /// String so it is byte-identical on every machine reading the contract.
    /// (A Symbol would force lossy sanitization of '/', '-', '.'; String does
    /// not, so no off-chain name recovery is needed.)
    pub repo_id: String,
    pub funder: Address,
    pub token: Address,
    pub balance: i128,
    /// "manual" | "automatic" — informational on-chain; enforced off-chain.
    pub approval_mode: Symbol,
}

// Gatekeeper interface for cross-contract membership checks.
//
// Declared as a client trait (rather than `contractimport!` of the built WASM)
// so this crate compiles without a build-order dependency on the gatekeeper
// WASM artifact, and so unit tests can register the native Gatekeeper contract.
// Soroban dispatches cross-contract calls by contract ID + function name, so a
// matching signature here is all that's required for the on-chain call.
mod gatekeeper {
    use soroban_sdk::{contractclient, BytesN, Env, String};

    #[contractclient(name = "GatekeeperClient")]
    pub trait Gatekeeper {
        fn is_member(env: Env, repo_id: String, commitment: BytesN<32>) -> bool;
    }
}

#[contract]
pub struct PerkContract;

#[contractimpl]
impl PerkContract {
    /// One-time setup: stores admin, the trusted relayer, and the deployed
    /// Gatekeeper contract address used for membership checks.
    pub fn initialize(
        env: Env,
        admin: Address,
        relayer: Address,
        gatekeeper: Address,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(
            &DataKey::Config,
            &Config {
                admin,
                relayer,
                gatekeeper,
            },
        );
        Ok(())
    }

    /// Admin creates a module: links it to a repo, sets token + approval mode.
    /// Funding is a separate call (`fund_module`).
    pub fn create_module(
        env: Env,
        admin: Address,
        module_id: Symbol,
        repo_id: String,
        token: Address,
        approval_mode: Symbol,
    ) -> Result<(), Error> {
        let config = Self::config(&env)?;
        admin.require_auth();
        if admin != config.admin {
            return Err(Error::NotAuthorized);
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::Module(module_id.clone()))
        {
            return Err(Error::ModuleExists);
        }
        let pool = ModulePool {
            module_id: module_id.clone(),
            repo_id,
            funder: admin,
            token,
            balance: 0,
            approval_mode,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Module(module_id.clone()), &pool);

        // Append to the on-chain index so `list_modules` can enumerate every
        // module. This is what makes the module set shared + live across all
        // clients/machines without any off-chain index.
        let mut index: Vec<Symbol> = env
            .storage()
            .persistent()
            .get(&DataKey::ModuleIndex)
            .unwrap_or_else(|| Vec::new(&env));
        index.push_back(module_id);
        env.storage()
            .persistent()
            .set(&DataKey::ModuleIndex, &index);
        Ok(())
    }

    /// Funder deposits tokens into a module's pool. Transfers `amount` of the
    /// module's token from `funder` to this contract.
    pub fn fund_module(
        env: Env,
        funder: Address,
        module_id: Symbol,
        amount: i128,
    ) -> Result<(), Error> {
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        funder.require_auth();
        let mut pool = Self::module(&env, &module_id)?;

        let client = token::Client::new(&env, &pool.token);
        client.transfer(&funder, &env.current_contract_address(), &amount);

        pool.balance += amount;
        env.storage()
            .persistent()
            .set(&DataKey::Module(module_id), &pool);
        Ok(())
    }

    /// Core claim. Caller is the trusted relayer, acting on behalf of the
    /// contributor after off-chain approval. Validates membership + nullifier,
    /// then pays out to `payout_address`.
    pub fn claim(
        env: Env,
        caller: Address,
        module_id: Symbol,
        commitment: BytesN<32>,
        nullifier: BytesN<32>,
        payout_address: Address,
        amount: i128,
    ) -> Result<(), Error> {
        let config = Self::config(&env)?;
        caller.require_auth();
        if caller != config.relayer {
            return Err(Error::NotAuthorized);
        }
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let mut pool = Self::module(&env, &module_id)?;

        // Cross-contract membership check against the Gatekeeper.
        let gk = gatekeeper::GatekeeperClient::new(&env, &config.gatekeeper);
        if !gk.is_member(&pool.repo_id, &commitment) {
            return Err(Error::NotAMember);
        }

        // Nullifier must be unused.
        let nk = DataKey::Nullifier(module_id.clone(), nullifier);
        if env.storage().persistent().get(&nk).unwrap_or(false) {
            return Err(Error::NullifierUsed);
        }

        if pool.balance < amount {
            return Err(Error::InsufficientBalance);
        }

        // Pay out from the pool.
        let client = token::Client::new(&env, &pool.token);
        client.transfer(&env.current_contract_address(), &payout_address, &amount);

        pool.balance -= amount;
        env.storage().persistent().set(&nk, &true);
        env.storage()
            .persistent()
            .set(&DataKey::Module(module_id), &pool);
        Ok(())
    }

    /// Read-only: current pool balance + module config for the dashboard.
    pub fn get_module(env: Env, module_id: Symbol) -> Result<ModulePool, Error> {
        Self::module(&env, &module_id)
    }

    /// Read-only: every module's full pool, in creation order. Backed by the
    /// on-chain `ModuleIndex`, so any client on any machine gets the identical,
    /// live module set directly from the contract — no off-chain index needed.
    /// Returns an empty vec before the first module is created.
    pub fn list_modules(env: Env) -> Vec<ModulePool> {
        let index: Vec<Symbol> = env
            .storage()
            .persistent()
            .get(&DataKey::ModuleIndex)
            .unwrap_or_else(|| Vec::new(&env));
        let mut out: Vec<ModulePool> = Vec::new(&env);
        for id in index.iter() {
            // Every id in the index was set alongside its pool, so this is
            // always present; skip defensively rather than panic if not.
            if let Some(pool) = env.storage().persistent().get(&DataKey::Module(id)) {
                out.push_back(pool);
            }
        }
        out
    }

    fn config(env: &Env) -> Result<Config, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(Error::NotInitialized)
    }

    fn module(env: &Env, module_id: &Symbol) -> Result<ModulePool, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Module(module_id.clone()))
            .ok_or(Error::ModuleNotFound)
    }
}

mod test;
