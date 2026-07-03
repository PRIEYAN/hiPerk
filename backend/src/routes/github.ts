import { Router } from "express";
import { store } from "../models/store.js";
import { config, githubOAuthConfigured } from "../config.js";
import * as verification from "../services/githubVerification.js";
import { analyzePrReward } from "../services/groqAnalysis.js";

/**
 * Off-chain GitHub PR-authorship verification (developer side).
 *
 * Flow: GET /oauth-url (app requests it) -> browser redirects to GitHub ->
 * GET /callback (GitHub redirects here) -> exchange code, fetch the GitHub
 * user, fetch the PR, confirm it's merged and authored by that user -> park
 * the boolean result under `state` -> redirect the browser back to the SPA ->
 * frontend polls GET /verify-status?state= -> POST /claims consumes the
 * verified result exactly once (see routes/claims.ts).
 *
 * This never touches the Perk/Gatekeeper contracts — it's a pure off-chain
 * gate in front of claim submission.
 */
export const githubRouter = Router();

githubRouter.get("/oauth-url", (req, res) => {
  if (!githubOAuthConfigured) {
    return res.status(503).json({ error: "GitHub OAuth is not configured on the server" });
  }
  const moduleId = req.query.moduleId as string | undefined;
  const prNumber = Number(req.query.prNumber);
  if (!moduleId) return res.status(400).json({ error: "moduleId required" });
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    return res.status(400).json({ error: "prNumber must be a positive integer" });
  }
  const m = store.getModule(moduleId);
  if (!m) return res.status(404).json({ error: "module not found" });
  const [owner, repo] = m.repoId.split("/");
  if (!owner || !repo) {
    return res.status(422).json({ error: `module repo "${m.repoId}" is not in "owner/repo" form` });
  }

  const state = verification.createPending({ moduleId, repoId: m.repoId, prNumber });
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", config.githubClientId);
  url.searchParams.set("redirect_uri", config.githubCallbackUrl);
  url.searchParams.set("state", state);
  url.searchParams.set("allow_signup", "false");
  res.json({ url: url.toString() });
});

githubRouter.get("/callback", async (req, res) => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  const pending = state ? verification.consumePending(state) : undefined;

  if (!code || !state || !pending) {
    return res.redirect(`${config.frontendUrl}/submit-proof?ghError=invalid_or_expired_request`);
  }

  try {
    const accessToken = await exchangeCode(code);
    const ghUser = await fetchGithubUser(accessToken);
    const [owner, repo] = pending.repoId.split("/");
    const pr = await fetchPullRequest(owner, repo, pending.prNumber, accessToken);

    const verified =
      !!pr?.merged && pr.user?.login?.toLowerCase() === ghUser.login.toLowerCase();
    const reason = verified
      ? undefined
      : !pr
        ? "pull request not found"
        : !pr.merged
          ? "pull request is not merged"
          : "pull request was not authored by the connected GitHub account";

    // On success, score the PR's complexity NOW (while we still hold the PR
    // stats transiently) and carry ONLY the resulting number forward. PR
    // identity/stats never touch the claim record (implementation.md §7).
    let complexity: number | undefined;
    if (verified && pr) {
      const m = store.getModule(pending.moduleId);
      const decision = await analyzePrReward(
        {
          additions: pr.additions ?? 0,
          deletions: pr.deletions ?? 0,
          changedFiles: pr.changed_files ?? 1,
          commits: pr.commits,
          title: pr.title,
        },
        m?.balance ?? 0,
      );
      complexity = decision.complexity;
    }

    verification.storeResult(state, { moduleId: pending.moduleId, verified, reason, complexity });
  } catch (e) {
    verification.storeResult(state, {
      moduleId: pending.moduleId,
      verified: false,
      reason: (e as Error).message || "GitHub verification failed",
    });
  }

  const back = new URL(`${config.frontendUrl}/submit-proof`);
  back.searchParams.set("moduleId", pending.moduleId);
  back.searchParams.set("ghState", state);
  back.searchParams.set("prNumber", String(pending.prNumber));
  res.redirect(back.toString());
});

githubRouter.get("/verify-status", (req, res) => {
  const state = req.query.state as string | undefined;
  if (!state) return res.status(400).json({ error: "state required" });
  const result = verification.peekResult(state);
  if (!result) return res.json({ verified: false, pending: true });
  res.json({ verified: result.verified, reason: result.reason, pending: false });
});

async function exchangeCode(code: string): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_id: config.githubClientId,
      client_secret: config.githubClientSecret,
      code,
      redirect_uri: config.githubCallbackUrl,
    }),
  });
  const data = (await res.json()) as { access_token?: string; error_description?: string };
  if (!data.access_token) {
    throw new Error(data.error_description || "failed to exchange GitHub OAuth code");
  }
  return data.access_token;
}

async function fetchGithubUser(token: string): Promise<{ login: string }> {
  const res = await fetch("https://api.github.com/user", {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error("could not read GitHub user profile");
  return res.json() as Promise<{ login: string }>;
}

interface GithubPr {
  merged: boolean;
  user?: { login: string };
  additions?: number;
  deletions?: number;
  changed_files?: number;
  commits?: number;
  title?: string;
}

async function fetchPullRequest(
  owner: string,
  repo: string,
  prNumber: number,
  token: string,
): Promise<GithubPr | undefined> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
  });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error("could not read pull request from GitHub");
  return res.json() as Promise<GithubPr>;
}
