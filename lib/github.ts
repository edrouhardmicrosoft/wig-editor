import { Octokit } from "@octokit/rest";

export type GitHubRepoConfig = {
  owner: string;
  repo: string;
  defaultBranch: string;
};

export function getRepoConfig(): GitHubRepoConfig {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const defaultBranch = process.env.GITHUB_DEFAULT_BRANCH ?? "main";

  if (!owner || !repo) {
    throw new Error(
      "Missing GitHub repo config. Set GITHUB_OWNER and GITHUB_REPO (and optionally GITHUB_DEFAULT_BRANCH).",
    );
  }

  return { owner, repo, defaultBranch };
}

export function getOctokit() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("Missing GITHUB_TOKEN");
  }

  return new Octokit({ auth: token });
}

export async function createBranch(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  baseBranch: string;
  newBranch: string;
}) {
  const { octokit, owner, repo, baseBranch, newBranch } = params;

  const { data: baseRef } = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${baseBranch}`,
  });

  const baseSha = baseRef.object.sha;

  await octokit.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${newBranch}`,
    sha: baseSha,
  });
}

export async function commitFile(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  branch: string;
  filePath: string;
  content: string;
  message: string;
}) {
  const { octokit, owner, repo, branch, filePath, content, message } = params;

  const contentBase64 = Buffer.from(content, "utf8").toString("base64");

  let existingSha: string | undefined;
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: filePath,
      ref: branch,
    });

    if (!Array.isArray(data) && data.type === "file") {
      existingSha = data.sha;
    }
  } catch (err: unknown) {
    const e = err as { status?: number };
    if (e?.status !== 404) throw err;
  }

  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: filePath,
    branch,
    message,
    content: contentBase64,
    ...(existingSha ? { sha: existingSha } : {}),
  });
}

export async function openPullRequest(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  baseBranch: string;
  headBranch: string;
  title: string;
  body?: string;
  draft?: boolean;
}) {
  const { octokit, owner, repo, baseBranch, headBranch, title, body, draft } =
    params;

  const { data: pr } = await octokit.rest.pulls.create({
    owner,
    repo,
    title,
    head: headBranch,
    base: baseBranch,
    body,
    draft: draft ?? true,
  });

  return pr;
}
