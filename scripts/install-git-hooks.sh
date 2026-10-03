#!/bin/sh
set -e
root=$(git rev-parse --show-toplevel)
src="$(cd "$(dirname "$0")/git-hooks" && pwd)"
dst="$root/.git/hooks"

git config user.name "Shane Wang"
git config user.email "shanewa@qq.com"
echo "Set local git user.name=Shane Wang, user.email=shanewa@qq.com"

for hook in "$src"/*; do
  [ -f "$hook" ] || continue
  name=$(basename "$hook")
  sed 's/\r$//' "$hook" > "$dst/$name"
  chmod +x "$dst/$name"
  echo "Installed $name"
done

echo "Git hooks installed to $dst"
