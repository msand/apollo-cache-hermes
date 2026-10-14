#!/usr/bin/env bash
# After a release from the default branch, updates the release-X.Y branch of
# the released version's line (see .github/workflows/release.yml), so that it
# holds the line's latest release:
#
# - creates it at the release if it doesn't exist (e.g. after 0.13.0);
# - fast-forwards it to the release if it is behind;
# - otherwise (it has commits the default branch doesn't, e.g. patches
#   released from it), merges the release into it, or leaves it as it is and
#   warns if the merge conflicts.
#
# Releases from other branches, and prereleases, leave release branches as
# they are. Runs in the release's checkout (HEAD is the release commit).
#
#   scripts/sync-release-branch.sh <version> <default branch> [--dry-run]

set -euo pipefail

version="$1"
default_branch="$2"
dry_run="${3:-}"

run() {
  if [[ "${dry_run}" == "--dry-run" ]]; then
    echo "(dry run) $*"
  else
    "$@"
  fi
}

if [[ "${version}" == *-* ]]; then
  echo "${version} is a prerelease: release branches are left as they are"
  exit 0
fi

release=$(git rev-parse HEAD)
line=$(echo "${version}" | cut -d. -f1,2)
branch="release-${line}"

git fetch --quiet origin "+refs/heads/*:refs/remotes/origin/*"

# A release from the default branch: a run on it (whose version commit isn't
# pushed in a dry run), or a tag of a commit on it.
if [[ "${GITHUB_EVENT_NAME:-}" == "workflow_dispatch" ]]; then
  from_default=$([[ "${GITHUB_REF_NAME:-}" == "${default_branch}" ]] && echo yes || echo no)
else
  from_default=$(git merge-base --is-ancestor "${release}" "origin/${default_branch}" && echo yes || echo no)
fi
if [[ "${from_default}" != "yes" ]]; then
  echo "v${version} wasn't released from ${default_branch}: release branches are left as they are"
  exit 0
fi

if ! git rev-parse --verify --quiet "refs/remotes/origin/${branch}" >/dev/null; then
  echo "Creating ${branch} at v${version}"
  run git push origin "${release}:refs/heads/${branch}"
elif git merge-base --is-ancestor "origin/${branch}" "${release}"; then
  echo "Fast-forwarding ${branch} to v${version}"
  run git push origin "${release}:refs/heads/${branch}"
else
  echo "Merging v${version} into ${branch}"
  git config user.name >/dev/null || git config user.name 'github-actions[bot]'
  git config user.email >/dev/null || git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
  git checkout --quiet --detach "origin/${branch}"
  if git merge --no-ff --quiet -m "Merge v${version} into ${branch}" "${release}"; then
    run git push origin "HEAD:refs/heads/${branch}"
  else
    git merge --abort
    echo "::warning::Merging v${version} into ${branch} conflicts: ${branch} is left as it is; merge it by hand"
  fi
  git checkout --quiet --detach "${release}"
fi
