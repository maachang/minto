---
description: MINTO_HOME環境変数とPATHをシェル設定ファイルへ自動追記する(bin/initMintoのラッパー)
allowed-tools: Bash(./bin/initMinto:*)
---

`./bin/initMinto` を実行してください。

手順:
1. Bashツールで `./bin/initMinto` を実行する。
2. 標準出力の内容(追記されたファイルパス、または既に設定済みでスキップした旨)をそのままユーザーに伝える。
3. 追記が行われた場合は、案内された `source {設定ファイル}` を実行するか、新しいターミナル(または新しいClaude Codeセッション)を開く必要があることを伝える。
4. 対応していないシェル(bash/zsh以外)の場合はエラーになるので、その場合は表示された`export MINTO_HOME=...`/`export PATH=...`を該当シェルの設定ファイルへ手動追記するよう案内する。
