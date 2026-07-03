import { config, groqConfigured } from "../config.js";

/**
 * Automated PR-complexity -> reward sizing (Groq AI).
 *
 * Given the *statistics* of a merged pull request (additions, deletions, files
 * changed, commit count, title) this asks a Groq LLM for a 1-10 complexity
 * score, then maps that score to a reward that is a small fraction of the
 * CURRENT pool balance. The reward is intentionally minimal and can never
 * exceed the pool.
 *
 * PRIVACY: only anonymous size statistics are sent to Groq — never the PR
 * author, the contributor's GitHub identity, or any commitment/nullifier.
 * This runs during the OAuth verification step (where PR data already lives
 * transiently); only the resulting NUMBER is carried forward into a claim, so
 * PR identity is never stored next to a claim (implementation.md §7).
 */

export interface PrStats {
  additions: number;
  deletions: number;
  changedFiles: number;
  commits?: number;
  title?: string;
}

export interface RewardDecision {
  /** 1 (trivial) .. 10 (very complex). */
  complexity: number;
  /** Reward amount in the pool's token units, capped at poolBalance. */
  reward: number;
  /** How the score was produced — "groq" or "heuristic" (fallback). */
  source: "groq" | "heuristic";
  /** Short human-readable rationale (safe to log/show; no PR identity). */
  rationale: string;
}

/** Clamp helper. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Map a 1-10 complexity score to a reward as a fraction of the pool.
 * score 1 -> rewardMinPoolPct, score 10 -> rewardMaxPoolPct, linear between.
 */
export function scoreToReward(complexity: number, poolBalance: number): number {
  const c = clamp(complexity, 1, 10);
  const minPct = config.rewardMinPoolPct;
  const maxPct = config.rewardMaxPoolPct;
  const pct = minPct + ((maxPct - minPct) * (c - 1)) / 9;
  const reward = Math.floor((poolBalance * pct) / 100);
  // Never zero for a valid claim (unless the pool itself is empty), never over-pool.
  return clamp(reward, poolBalance > 0 ? 1 : 0, poolBalance);
}

/**
 * Deterministic local fallback when Groq is unavailable. Rough complexity from
 * total churn + files touched, bucketed into 1-10.
 */
function heuristicComplexity(stats: PrStats): number {
  const churn = (stats.additions ?? 0) + (stats.deletions ?? 0);
  const files = stats.changedFiles ?? 1;
  // log-ish buckets so a 5000-line PR isn't 500x a 10-line PR.
  let score = 1;
  if (churn > 10) score = 2;
  if (churn > 50) score = 3;
  if (churn > 150) score = 4;
  if (churn > 400) score = 6;
  if (churn > 1000) score = 8;
  if (churn > 2500) score = 10;
  if (files > 10) score = Math.min(10, score + 1);
  if (files > 30) score = Math.min(10, score + 1);
  return score;
}

async function askGroq(stats: PrStats): Promise<number> {
  const prompt =
    `You are scoring the engineering complexity of a merged pull request so a ` +
    `bounty pool can pay a proportional, MINIMAL reward. Consider size, breadth, ` +
    `and likely difficulty. Respond with ONLY a JSON object of the form ` +
    `{"complexity": <integer 1-10>} and nothing else.\n\n` +
    `Pull request statistics (anonymous — no author info):\n` +
    `- additions: ${stats.additions}\n` +
    `- deletions: ${stats.deletions}\n` +
    `- files changed: ${stats.changedFiles}\n` +
    `- commits: ${stats.commits ?? "unknown"}\n` +
    `- title: ${stats.title ? JSON.stringify(stats.title) : "unknown"}\n`;

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.groqApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.groqModel,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`groq ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  const parsed = JSON.parse(content) as { complexity?: number };
  const score = Number(parsed.complexity);
  if (!Number.isFinite(score)) throw new Error("groq returned no numeric complexity");
  return clamp(Math.round(score), 1, 10);
}

/**
 * Analyze a merged PR's stats and decide the reward for the given pool balance.
 * Never throws — falls back to the local heuristic on any Groq error so the
 * automated claim flow can always proceed.
 */
export async function analyzePrReward(
  stats: PrStats,
  poolBalance: number,
): Promise<RewardDecision> {
  if (poolBalance <= 0) {
    return { complexity: 1, reward: 0, source: "heuristic", rationale: "pool empty" };
  }

  if (groqConfigured) {
    try {
      const complexity = await askGroq(stats);
      return {
        complexity,
        reward: scoreToReward(complexity, poolBalance),
        source: "groq",
        rationale: `Groq scored complexity ${complexity}/10 from PR size stats`,
      };
    } catch (e) {
      console.warn(`[groq] analysis failed, using heuristic: ${(e as Error).message}`);
    }
  }

  const complexity = heuristicComplexity(stats);
  return {
    complexity,
    reward: scoreToReward(complexity, poolBalance),
    source: "heuristic",
    rationale: `heuristic complexity ${complexity}/10 (${
      groqConfigured ? "Groq unavailable" : "GROQ_API_KEY not set"
    })`,
  };
}
