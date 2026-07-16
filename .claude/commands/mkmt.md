---
description: 新しいmintoプロジェクトを作成する(bin/mkmtのラッパー)
argument-hint: <プロジェクト名>
allowed-tools: Bash(./bin/mkmt:*)
---

引数として渡されたプロジェクト名で、新しいmintoプロジェクトを作成してください。

引数: $ARGUMENTS

手順:
1. 引数が空の場合は、作成したいプロジェクト名をユーザーに確認する(独断で名前を決めない)。
2. Bashツールで `./bin/mkmt {プロジェクト名}` を実行する(カレントディレクトリ配下に作成される)。
3. `[ERROR] Project directory already exists: ...` の場合は、同名ディレクトリが既に存在する旨をそのまま伝える(上書きなどはしない)。
4. 成功した場合は、生成された内容(`public/`・`lib/`・`conf/env.json`・`conf/minto.json`・`package.json`・`.claude/CLAUDE.md`)と、次のステップ(`cd {プロジェクト名} && npm install`)を案内する。
