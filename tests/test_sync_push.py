"""The sync publish step can update a branch that already exists on the remote."""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "open_sync_pr.sh"


def git(args, cwd, env=None):
    merged = os.environ.copy()
    merged.update(env or {})
    subprocess.run(["git", *args], cwd=cwd, env=merged, check=True, capture_output=True, text=True)


def commit(cwd, message, path="note.txt", text="one", name=None, email=None):
    file = Path(cwd) / path
    file.write_text(text)
    git(["add", path], cwd)
    args = ["commit", "-m", message]
    if name:
        args = ["-c", f"user.name={name}", "-c", f"user.email={email}", *args]
    git(args, cwd)


BOT = ("github-actions[bot]", "github-actions[bot]@users.noreply.github.com")


class SyncPushTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        base = Path(self.tmp.name)
        self.remote = base / "remote.git"
        self.seed = base / "seed"
        self.worker = base / "worker"
        subprocess.run(["git", "init", "--bare", self.remote], check=True, capture_output=True)
        subprocess.run(["git", "init", "-b", "main", self.seed], check=True, capture_output=True)
        git(["config", "user.email", "sync@example.com"], self.seed)
        git(["config", "user.name", "Sync"], self.seed)
        commit(self.seed, "main")
        git(["remote", "add", "origin", self.remote.as_uri()], self.seed)
        git(["push", "-u", "origin", "main"], self.seed)
        self.branch = "workbook-sync-2026-11-05"
        git(["checkout", "-B", self.branch], self.seed)
        commit(self.seed, "first sync", text="first", name=BOT[0], email=BOT[1])
        git(["push", "-u", "origin", self.branch], self.seed)
        subprocess.run(
            ["git", "clone", "--single-branch", "--branch", "main", self.remote.as_uri(), self.worker],
            check=True,
            capture_output=True,
        )
        git(["config", "user.email", "sync@example.com"], self.worker)
        git(["config", "user.name", "Sync"], self.worker)

    def test_naive_lease_is_rejected_when_the_branch_was_not_fetched(self):
        git(["checkout", "-B", self.branch], self.worker)
        commit(self.worker, "second sync", text="second")
        result = subprocess.run(
            ["git", "push", "--force-with-lease", "-u", "origin", f"HEAD:refs/heads/{self.branch}"],
            cwd=self.worker,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("stale info", result.stderr)

    def test_fetched_lease_updates_the_existing_branch(self):
        git(["checkout", "-B", self.branch], self.worker)
        commit(self.worker, "second sync", text="second")
        dry = subprocess.run(
            ["bash", str(SCRIPT), self.branch],
            cwd=self.worker,
            env={**os.environ, "SYNC_PUSH_DRY_RUN": "1"},
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertTrue(dry.stdout.startswith(f"lease {self.branch} "))
        subprocess.run(
            ["bash", str(SCRIPT), self.branch],
            cwd=self.worker,
            env={**os.environ, "SYNC_SKIP_PR": "1"},
            check=True,
            capture_output=True,
            text=True,
        )
        remote = subprocess.run(
            ["git", "--git-dir", self.remote, "rev-parse", self.branch],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        local = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=self.worker,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        self.assertEqual(remote, local)

    def test_missing_branch_is_created(self):
        branch = "workbook-sync-2026-11-06"
        git(["checkout", "-B", branch], self.worker)
        commit(self.worker, "new day", text="new")
        dry = subprocess.run(
            ["bash", str(SCRIPT), branch],
            cwd=self.worker,
            env={**os.environ, "SYNC_PUSH_DRY_RUN": "1"},
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertEqual(dry.stdout.strip(), f"create {branch}")
        subprocess.run(
            ["bash", str(SCRIPT), branch],
            cwd=self.worker,
            env={**os.environ, "SYNC_SKIP_PR": "1"},
            check=True,
            capture_output=True,
            text=True,
        )
        remote = subprocess.run(
            ["git", "--git-dir", self.remote, "rev-parse", branch],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        self.assertTrue(remote)

    def test_non_bot_commits_open_a_fresh_branch(self):
        commit(self.seed, "keep the fix", path="fix.txt", text="human")
        git(["push", "origin", self.branch], self.seed)
        kept = subprocess.run(
            ["git", "--git-dir", self.remote, "rev-parse", self.branch],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        git(["checkout", "-B", self.branch], self.worker)
        commit(self.worker, "second sync", text="second")
        fresh = f"{self.branch}-2"
        dry = subprocess.run(
            ["bash", str(SCRIPT), self.branch],
            cwd=self.worker,
            env={**os.environ, "SYNC_PUSH_DRY_RUN": "1"},
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertEqual(dry.stdout.strip(), f"fresh {fresh}")
        subprocess.run(
            ["bash", str(SCRIPT), self.branch],
            cwd=self.worker,
            env={**os.environ, "SYNC_SKIP_PR": "1"},
            check=True,
            capture_output=True,
            text=True,
        )
        still = subprocess.run(
            ["git", "--git-dir", self.remote, "rev-parse", self.branch],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        opened = subprocess.run(
            ["git", "--git-dir", self.remote, "rev-parse", fresh],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        local = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=self.worker,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        self.assertEqual(still, kept)
        self.assertEqual(opened, local)
        self.assertNotEqual(opened, kept)

    def test_reuses_an_older_bot_branch_instead_of_opening_today(self):
        desired = "workbook-sync-2026-11-06"
        git(["checkout", "-B", desired], self.worker)
        commit(self.worker, "second sync", text="second")
        dry = subprocess.run(
            ["bash", str(SCRIPT), desired],
            cwd=self.worker,
            env={**os.environ, "SYNC_PUSH_DRY_RUN": "1", "SYNC_REUSE_BRANCH": self.branch},
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertTrue(dry.stdout.startswith(f"lease {self.branch} "))
        subprocess.run(
            ["bash", str(SCRIPT), desired],
            cwd=self.worker,
            env={**os.environ, "SYNC_SKIP_PR": "1", "SYNC_REUSE_BRANCH": self.branch},
            check=True,
            capture_output=True,
            text=True,
        )
        remote = subprocess.run(
            ["git", "--git-dir", self.remote, "rev-parse", self.branch],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        local = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=self.worker,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        missing = subprocess.run(
            ["git", "--git-dir", self.remote, "rev-parse", "--verify", desired],
            capture_output=True,
            text=True,
        )
        self.assertEqual(remote, local)
        self.assertNotEqual(missing.returncode, 0)

    def test_same_tree_does_not_force_push(self):
        before = subprocess.run(
            ["git", "--git-dir", self.remote, "rev-parse", self.branch],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        git(["checkout", "-B", self.branch], self.worker)
        commit(self.worker, "second sync", text="first")
        dry = subprocess.run(
            ["bash", str(SCRIPT), self.branch],
            cwd=self.worker,
            env={**os.environ, "SYNC_PUSH_DRY_RUN": "1"},
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertEqual(dry.stdout.strip(), f"unchanged {self.branch}")
        subprocess.run(
            ["bash", str(SCRIPT), self.branch],
            cwd=self.worker,
            env={**os.environ, "SYNC_SKIP_PR": "1"},
            check=True,
            capture_output=True,
            text=True,
        )
        after = subprocess.run(
            ["git", "--git-dir", self.remote, "rev-parse", self.branch],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        self.assertEqual(after, before)

    def test_update_only_does_not_open_a_pull_request(self):
        desired = "workbook-sync-2026-11-06"
        git(["checkout", "-B", desired], self.worker)
        commit(self.worker, "failed checks", text="failed")
        dry = subprocess.run(
            ["bash", str(SCRIPT), desired],
            cwd=self.worker,
            env={**os.environ, "SYNC_PUSH_DRY_RUN": "1", "SYNC_UPDATE_ONLY": "1"},
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertEqual(dry.stdout.strip(), "skip")
        subprocess.run(
            ["bash", str(SCRIPT), desired],
            cwd=self.worker,
            env={**os.environ, "SYNC_SKIP_PR": "1", "SYNC_UPDATE_ONLY": "1"},
            check=True,
            capture_output=True,
            text=True,
        )
        missing = subprocess.run(
            ["git", "--git-dir", self.remote, "rev-parse", "--verify", desired],
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(missing.returncode, 0)

    def test_update_only_leaves_a_non_bot_branch_alone(self):
        commit(self.seed, "keep the fix", path="fix.txt", text="human")
        git(["push", "origin", self.branch], self.seed)
        kept = subprocess.run(
            ["git", "--git-dir", self.remote, "rev-parse", self.branch],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        git(["checkout", "-B", self.branch], self.worker)
        commit(self.worker, "second sync", text="second")
        dry = subprocess.run(
            ["bash", str(SCRIPT), self.branch],
            cwd=self.worker,
            env={
                **os.environ,
                "SYNC_PUSH_DRY_RUN": "1",
                "SYNC_UPDATE_ONLY": "1",
                "SYNC_REUSE_BRANCH": self.branch,
            },
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertEqual(dry.stdout.strip(), "skip")
        subprocess.run(
            ["bash", str(SCRIPT), self.branch],
            cwd=self.worker,
            env={
                **os.environ,
                "SYNC_SKIP_PR": "1",
                "SYNC_UPDATE_ONLY": "1",
                "SYNC_REUSE_BRANCH": self.branch,
            },
            check=True,
            capture_output=True,
            text=True,
        )
        still = subprocess.run(
            ["git", "--git-dir", self.remote, "rev-parse", self.branch],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        fresh = subprocess.run(
            ["git", "--git-dir", self.remote, "rev-parse", "--verify", f"{self.branch}-2"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(still, kept)
        self.assertNotEqual(fresh.returncode, 0)

    def test_discover_reuses_the_open_bot_pull_request(self):
        bindir = Path(self.tmp.name) / "bin"
        bindir.mkdir()
        gh = bindir / "gh"
        gh.write_text(
            "#!/bin/sh\n"
            "if [ \"$1\" = \"pr\" ] && [ \"$2\" = \"list\" ]; then\n"
            f"  printf '%s\\n' '{self.branch}'\n"
            "  exit 0\n"
            "fi\n"
            "echo \"unexpected gh $*\" >&2\n"
            "exit 1\n"
        )
        gh.chmod(0o755)
        desired = "workbook-sync-2026-11-06"
        git(["checkout", "-B", desired], self.worker)
        commit(self.worker, "second sync", text="second")
        dry = subprocess.run(
            ["bash", str(SCRIPT), desired],
            cwd=self.worker,
            env={
                **os.environ,
                "PATH": f"{bindir}{os.pathsep}{os.environ.get('PATH', '')}",
                "SYNC_PUSH_DRY_RUN": "1",
                "SYNC_DISCOVER_PR": "1",
            },
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertTrue(dry.stdout.startswith(f"lease {self.branch} "), dry.stdout)


if __name__ == "__main__":
    unittest.main()
