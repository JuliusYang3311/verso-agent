---
summary: "How the installer scripts work (install.sh, install-cli.sh, install.ps1), flags, and automation"
read_when:
  - You want to understand `openclaw.ai/install.sh`
  - You want to automate installs (CI / headless)
  - You want to install from a GitHub checkout
title: "Installer Internals"
---

# Installer internals

Verso ships two installer scripts (served from `molt.bot`):

| Script                             | Platform             | What it does                                                                              |
| ---------------------------------- | -------------------- | ----------------------------------------------------------------------------------------- |
| [`install.sh`](#installsh)         | macOS / Linux / WSL  | Installs Node if needed, installs Verso via npm (default) or git, and can run onboarding. |
| [`install-cli.sh`](#install-clish) | macOS / Linux / WSL  | Installs Node + Verso into a local prefix (`~/.openclaw`). No root required.              |
| [`install.ps1`](#installps1)       | Windows (PowerShell) | Installs Node if needed, installs Verso via npm (default) or git, and can run onboarding. |

## Quick commands

<Tabs>
  <Tab title="install.sh">
    ```bash
    curl -fsSL --proto '=https' --tlsv1.2 https://openclaw.ai/install.sh | bash
    ```

    ```bash
    curl -fsSL --proto '=https' --tlsv1.2 https://openclaw.ai/install.sh | bash -s -- --help
    ```

  </Tab>
  <Tab title="install-cli.sh">
    ```bash
    curl -fsSL --proto '=https' --tlsv1.2 https://openclaw.ai/install-cli.sh | bash
    ```

If the installer completes but `verso` is not found in a new terminal, it’s usually a Node/npm PATH issue. See: [Install](/install#nodejs--npm-path-sanity).

<Note>
If install succeeds but `openclaw` is not found in a new terminal, see [Node.js troubleshooting](/install/node#troubleshooting).
</Note>

---

## install.sh

If you run the installer while **already inside a Verso source checkout** (detected via `package.json` + `pnpm-workspace.yaml`), it prompts:

<AccordionGroup>
  <Accordion title="Flags reference">

| Flag                   | Description                                                                     |
| ---------------------- | ------------------------------------------------------------------------------- |
| `--prefix <path>`      | Install prefix (default: `~/.openclaw`)                                         |
| `--version <ver>`      | Verso version or dist-tag (default: `latest`)                                   |
| `--node-version <ver>` | Node version (default: `22.22.0`)                                               |
| `--json`               | Emit NDJSON events                                                              |
| `--onboard`            | Run `openclaw onboard` after install                                            |
| `--no-onboard`         | Skip onboarding (default)                                                       |
| `--set-npm-prefix`     | On Linux, force npm prefix to `~/.npm-global` if current prefix is not writable |
| `--help`               | Show usage (`-h`)                                                               |

  </Accordion>

- **npm error spawn git / ENOENT**: install Git for Windows and reopen PowerShell, then rerun the installer.
- **"verso" is not recognized**: your npm global bin folder is not on PATH. Most systems use
  `%AppData%\\npm`. You can also run `npm config get prefix` and add `\\bin` to PATH, then reopen PowerShell.
  =======
  <Accordion title="Environment variables reference">

| Variable                                    | Description                                                                       |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| `OPENCLAW_PREFIX=<path>`                    | Install prefix                                                                    |
| `OPENCLAW_VERSION=<ver>`                    | Verso version or dist-tag                                                         |
| `OPENCLAW_NODE_VERSION=<ver>`               | Node version                                                                      |
| `OPENCLAW_NO_ONBOARD=1`                     | Skip onboarding                                                                   |
| `OPENCLAW_NPM_LOGLEVEL=error\|warn\|notice` | npm log level                                                                     |
| `OPENCLAW_GIT_DIR=<path>`                   | Legacy cleanup lookup path (used when removing old `Peekaboo` submodule checkout) |
| `SHARP_IGNORE_GLOBAL_LIBVIPS=0\|1`          | Control sharp/libvips behavior (default: `1`)                                     |

  </Accordion>
</AccordionGroup>

---

## install.ps1

### Flow (install.ps1)

<Steps>
  <Step title="Ensure PowerShell + Windows environment">
    Requires PowerShell 5+.
  </Step>
  <Step title="Ensure Node.js 22+">
    If missing, attempts install via winget, then Chocolatey, then Scoop.
  </Step>
  <Step title="Install Verso">
    - `npm` method (default): global npm install using selected `-Tag`
    - `git` method: clone/update repo, install/build with pnpm, and install wrapper at `%USERPROFILE%\.local\bin\openclaw.cmd`
  </Step>
  <Step title="Post-install tasks">
    Adds needed bin directory to user PATH when possible, then runs `openclaw doctor --non-interactive` on upgrades and git installs (best effort).
  </Step>
</Steps>

### Examples (install.ps1)

<Tabs>
  <Tab title="Default">
    ```powershell
    iwr -useb https://openclaw.ai/install.ps1 | iex
    ```
  </Tab>
  <Tab title="Git install">
    ```powershell
    & ([scriptblock]::Create((iwr -useb https://openclaw.ai/install.ps1))) -InstallMethod git
    ```
  </Tab>
  <Tab title="Custom git directory">
    ```powershell
    & ([scriptblock]::Create((iwr -useb https://openclaw.ai/install.ps1))) -InstallMethod git -GitDir "C:\openclaw"
    ```
  </Tab>
  <Tab title="Dry run">
    ```powershell
    & ([scriptblock]::Create((iwr -useb https://openclaw.ai/install.ps1))) -DryRun
    ```
  </Tab>
</Tabs>

<AccordionGroup>
  <Accordion title="Flags reference">

| Flag                      | Description                                            |
| ------------------------- | ------------------------------------------------------ |
| `-InstallMethod npm\|git` | Install method (default: `npm`)                        |
| `-Tag <tag>`              | npm dist-tag (default: `latest`)                       |
| `-GitDir <path>`          | Checkout directory (default: `%USERPROFILE%\openclaw`) |
| `-NoOnboard`              | Skip onboarding                                        |
| `-NoGitUpdate`            | Skip `git pull`                                        |
| `-DryRun`                 | Print actions only                                     |

  </Accordion>

  <Accordion title="Environment variables reference">

| Variable                           | Description        |
| ---------------------------------- | ------------------ |
| `OPENCLAW_INSTALL_METHOD=git\|npm` | Install method     |
| `OPENCLAW_GIT_DIR=<path>`          | Checkout directory |
| `OPENCLAW_NO_ONBOARD=1`            | Skip onboarding    |
| `OPENCLAW_GIT_UPDATE=0`            | Disable git pull   |
| `OPENCLAW_DRY_RUN=1`               | Dry run mode       |

  </Accordion>
</AccordionGroup>

<Note>
If `-InstallMethod git` is used and Git is missing, the script exits and prints the Git for Windows link.
</Note>

---

## CI and automation

Use non-interactive flags/env vars for predictable runs.

<Tabs>
  <Tab title="install.sh (non-interactive npm)">
    ```bash
    curl -fsSL --proto '=https' --tlsv1.2 https://openclaw.ai/install.sh | bash -s -- --no-prompt --no-onboard
    ```
  </Tab>
  <Tab title="install.sh (non-interactive git)">
    ```bash
    OPENCLAW_INSTALL_METHOD=git OPENCLAW_NO_PROMPT=1 \
      curl -fsSL --proto '=https' --tlsv1.2 https://openclaw.ai/install.sh | bash
    ```
  </Tab>
  <Tab title="install-cli.sh (JSON)">
    ```bash
    curl -fsSL --proto '=https' --tlsv1.2 https://openclaw.ai/install-cli.sh | bash -s -- --json --prefix /opt/openclaw
    ```
  </Tab>
  <Tab title="install.ps1 (skip onboarding)">
    ```powershell
    & ([scriptblock]::Create((iwr -useb https://openclaw.ai/install.ps1))) -NoOnboard
    ```
  </Tab>
</Tabs>

---

## Troubleshooting

<AccordionGroup>
  <Accordion title="Why is Git required?">
    Git is required for `git` install method. For `npm` installs, Git is still checked/installed to avoid `spawn git ENOENT` failures when dependencies use git URLs.
  </Accordion>

  <Accordion title="Why does npm hit EACCES on Linux?">
    Some Linux setups point npm global prefix to root-owned paths. `install.sh` can switch prefix to `~/.npm-global` and append PATH exports to shell rc files (when those files exist).
  </Accordion>

  <Accordion title="sharp/libvips issues">
    The scripts default `SHARP_IGNORE_GLOBAL_LIBVIPS=1` to avoid sharp building against system libvips. To override:

    ```bash
    SHARP_IGNORE_GLOBAL_LIBVIPS=0 curl -fsSL --proto '=https' --tlsv1.2 https://openclaw.ai/install.sh | bash
    ```

  </Accordion>

  <Accordion title='Windows: "npm error spawn git / ENOENT"'>
    Install Git for Windows, reopen PowerShell, rerun installer.
  </Accordion>

  <Accordion title='Windows: "openclaw is not recognized"'>
    Run `npm config get prefix`, append `\bin`, add that directory to user PATH, then reopen PowerShell.
  </Accordion>

  <Accordion title="openclaw not found after install">
    Usually a PATH issue. See [Node.js troubleshooting](/install/node#troubleshooting).
  </Accordion>
</AccordionGroup>
>>>>>>> upstream/main
