"""Publish only reviewed model cards, the original recording and the starter ZIP."""

from pathlib import Path

from huggingface_hub import CommitOperationAdd, HfApi, get_token, hf_hub_download

ROOT = Path(__file__).resolve().parents[1]
# Refuse to overwrite a model card changed since these sources were prepared.
BASE_REVISIONS = {
    "X2Streaming-TTS-1.7B": "33858c61c73797136edd2e9bd427e2677c9b2601",
    "X2-NativeCursor-Qwen3TTS-12Hz": "8f9fc9fe943346fb43a21da5b2cd7628e4659f4c",
}


def main():
    if not get_token():
        raise SystemExit(
            "HF upload pending: run hf auth login with repository write access, then rerun."
        )
    api = HfApi()
    for name, base in BASE_REVISIONS.items():
        repo = "x-square-robot/" + name
        current = api.model_info(repo).sha
        before = Path(hf_hub_download(repo, "README.md", revision=base)).read_bytes()
        latest = Path(hf_hub_download(repo, "README.md", revision=current)).read_bytes()
        desired = (ROOT / "hf" / name / "README.md").read_bytes()
        if latest not in (before, desired):
            raise SystemExit(
                f"{repo}: model card changed remotely; merge it before uploading."
            )
        files = {
            "README.md": ROOT / "hf" / name / "README.md",
            "assets/native_cursor_lab.mp4": ROOT / "docs/assets/native_cursor_lab.mp4",
            "quickstart/x2streaming-quickstart.zip": ROOT
            / "web/packages/demo/public/x2streaming-quickstart.zip",
        }
        for path in files.values():
            if not path.is_file():
                raise SystemExit(f"Missing artifact: {path}; build the starter first.")
        result = api.create_commit(
            repo_id=repo,
            repo_type="model",
            parent_commit=current,
            operations=[
                CommitOperationAdd(path_in_repo=name, path_or_fileobj=str(path))
                for name, path in files.items()
            ],
            commit_message="docs: add live demo and verified service quick start",
        )
        print(repo, result.commit_url)


if __name__ == "__main__":
    main()
