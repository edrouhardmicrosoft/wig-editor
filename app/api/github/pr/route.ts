import { NextResponse } from "next/server";

import { getOctokit, getRepoConfig, openPullRequest } from "@/lib/github";

type PrRequest = {
  branchName: string;
  title: string;
  body: string;
};

function isPrRequest(value: unknown): value is PrRequest {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;

  return (
    typeof v.branchName === "string" &&
    typeof v.title === "string" &&
    typeof v.body === "string"
  );
}

export async function POST(req: Request) {
  const json = (await req.json()) as unknown;
  if (!isPrRequest(json)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const octokit = getOctokit();
  const { owner, repo, defaultBranch } = getRepoConfig();

  try {
    const pr = await openPullRequest({
      octokit,
      owner,
      repo,
      baseBranch: defaultBranch,
      headBranch: json.branchName,
      title: json.title,
      body: json.body,
      draft: true,
    });

    return NextResponse.json({ url: pr.html_url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
