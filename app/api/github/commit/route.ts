import { NextResponse } from "next/server";

import { commitFile, createBranch, getOctokit, getRepoConfig } from "@/lib/github";

type CommitRequest = {
  filePath: string;
  content: string;
  message: string;
};

function isCommitRequest(value: unknown): value is CommitRequest {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;

  return (
    typeof v.filePath === "string" &&
    typeof v.content === "string" &&
    typeof v.message === "string"
  );
}

export async function POST(req: Request) {
  const json = (await req.json()) as unknown;
  if (!isCommitRequest(json)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const octokit = getOctokit();
  const { owner, repo, defaultBranch } = getRepoConfig();

  const branchName = `wig/${Date.now()}`;

  try {
    await createBranch({
      octokit,
      owner,
      repo,
      baseBranch: defaultBranch,
      newBranch: branchName,
    });

    await commitFile({
      octokit,
      owner,
      repo,
      branch: branchName,
      filePath: json.filePath,
      content: json.content,
      message: json.message,
    });

    return NextResponse.json({ branchName });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
