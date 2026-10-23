#!/usr/bin/env bash
# Prepare Pedro's development checkout. Safe to paste into an interactive Bash shell.
{
  printf '\nSTART COPY HERE\n'

  roborock_setup_dev() {
    local dev_dir="/home/pedro/devProjects/local_roborock_server"
    local fork_https="https://github.com/pponce/local_roborock_server.git"
    local fork_ssh="git@github.com:pponce/local_roborock_server.git"
    local upstream_https="https://github.com/Python-roborock/local_roborock_server.git"
    local upstream_ssh="git@github.com:Python-roborock/local_roborock_server.git"
    local origin_url upstream_url

    if [ "$(id -un)" != "pedro" ]; then
      printf 'ERROR: Run this as pedro, without sudo.\n'
      return 1
    fi
    if ! command -v git >/dev/null 2>&1; then
      printf 'ERROR: Git is required. Install Git, then run this again.\n'
      return 1
    fi

    printf '\n===== DEVELOPMENT CHECKOUT =====\n'
    mkdir -p /home/pedro/devProjects || return 1
    if [ ! -e "$dev_dir/.git" ]; then
      # Git refuses to clone over a nonempty directory.
      git clone --branch main "$fork_https" "$dev_dir" || return 1
    fi
    cd "$dev_dir" || return 1

    origin_url=$(git remote get-url --all origin) || return 1
    case "$origin_url" in
      "$fork_https" | "${fork_https%.git}" | "$fork_ssh" | "${fork_ssh%.git}") ;;
      *)
        printf 'ERROR: Existing origin does not match Pedro\047s fork; leaving it unchanged.\n'
        return 1
        ;;
    esac

    if upstream_url=$(git remote get-url --all upstream 2>/dev/null); then
      case "$upstream_url" in
        "$upstream_https" | "${upstream_https%.git}" | "$upstream_ssh" | "${upstream_ssh%.git}") ;;
        *)
          printf 'ERROR: Existing upstream does not match Python-roborock; leaving it unchanged.\n'
          return 1
          ;;
      esac
    else
      git remote add upstream "$upstream_https" || return 1
    fi

    printf '\n===== REMOTES AND FETCH =====\n'
    git remote set-url origin "$fork_https" || return 1
    git config --replace-all remote.origin.pushurl "$fork_ssh" || return 1
    git fetch origin || return 1
    git fetch upstream || return 1

    printf '\n===== CURRENT BRANCH =====\n'
    git branch --show-current || return 1
    git status --short --branch || return 1
    printf '\n===== REMOTES =====\n'
    git remote -v || return 1
    printf '\nReady: %s\n' "$dev_dir"
    printf 'Existing branches and working files were preserved; no pull or merge was performed.\n'
    printf 'Docker and /opt/local_roborock_server have not been installed or changed.\n'
  }

  if roborock_setup_dev; then
    printf '\nSetup exit status: 0\n'
  else
    printf '\nSetup exit status: %s (setup incomplete; see the error above)\n' "$?"
  fi
  unset -f roborock_setup_dev

  printf '\nEND COPY HERE\n'
}
