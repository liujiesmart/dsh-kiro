# NOTICE

## Provenance

This project is a **fork**, and it is presented as one on purpose: the
attribution below is the condition under which the upstream MIT licences allow
it to exist.

| Role | Repository | Licence |
|---|---|---|
| Immediate upstream (this repository forked from it) | [dat-lequoc/dsh-kiro](https://github.com/dat-lequoc/dsh-kiro) | MIT |
| Upstream of that project | [caopu16/dsh-llm-kiro](https://github.com/caopu16/dsh-llm-kiro) | MIT |
| Behaviour cross-checked against | [decolua/9router](https://github.com/decolua/9router), [dat-lequoc/Kiro-Go](https://github.com/dat-lequoc/Kiro-Go) | see those repositories |

`dat-lequoc/dsh-kiro` is a GitHub fork of this repository's content and was the
source of the code that became commit `0f72b78` here. The MIT terms that came
with it are reproduced verbatim in [LICENSE](LICENSE); the copyright lines of
both original holders, `dat-lequoc` and `caopu16`, are kept unchanged, and this
fork adds no copyright claim over their work.

## What this fork changes

Downstream work is additive: it fixes provider behaviour that the upstream
release does not cover. The commits after the upstream base are the record;
the substantive changes are:

- `dsh-kiro` as the provider route name, so the adapter can coexist with other
  configurations that declare a bare `kiro` route.
- Multiple managed accounts, live account model discovery, and persisted model
  selection.
- Silent-refusal recovery: a billed, content-free response is retried with a
  strictly smaller request instead of ending the turn.

Nothing in this fork removes or relicenses upstream code. If a file here and a
file upstream disagree, the upstream copy is the authority on what the upstream
authors wrote.

## Trade marks

Kiro and the Kiro logo are trade marks of Amazon.com, Inc. or its affiliates.
The logo in `assets/kiro-icon.svg` is sourced from the official
[Kiro website](https://kiro.dev/icon.svg) and is used only to identify
compatibility with Kiro. It is not covered by this project's MIT licence.

DeepSeek Harness and DSH are products of their respective owners; this project
is a third-party plugin for that harness.

This project is independent. It is not affiliated with, sponsored by, endorsed
by, or supported by Amazon Web Services, Amazon.com, Kiro, or DeepSeek. No
upstream project or company reviewed, approved, or maintains this fork.

## Service terms are the operator's obligation

This plugin talks to Kiro's service with the operator's own signed-in
credentials. It is an unofficial client: the endpoints it calls are used by
Kiro's own IDE and are not a documented public API, and they can change or be
restricted at any time.

Installing and using this plugin does not grant any right to Kiro's service.
Whether a given use is permitted is decided by the agreement between the
operator and Kiro — not by this project. Operators are responsible for reading
and following those terms, for the accounts and credentials they sign in with,
and for any allowance or credit the plugin spends.

## No warranty

The software is provided "as is", without warranty of any kind, as stated in
[LICENSE](LICENSE). The authors are not liable for lost credits, suspended
accounts, lost data, or any other damage arising from its use.