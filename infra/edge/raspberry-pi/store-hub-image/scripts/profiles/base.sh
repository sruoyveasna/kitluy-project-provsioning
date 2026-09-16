#!/usr/bin/env bash
# KitLuy OS image — SHARED BASE composition.
#
# Everything both profiles need: security hardening, device identity bootstrap,
# firstboot, logging, the update agent, health reporting and the enrollment
# client. A Store Hub and a Pi terminal are the same platform with different
# roles — this file is where that shared foundation is expressed, so the two
# profiles cannot drift into unrelated operating systems.

# kitluy_profile_base_compose <stage_root>
kitluy_profile_base_compose() {
  local root="${1:-}"
  [[ -n "$root" ]] || die "base compose: no stage root"

  install -d "${root}/etc/kitluy" \
             "${root}/var/lib/kitluy" \
             "${root}/usr/lib/kitluy"

  # Device identity lives on the encrypted data partition and is created on the
  # device. The private key NEVER leaves the device and is never uploaded
  # (mission §30; the identity rule in @kitluy/device-identity).
  install -d -m 0700 "${root}/var/lib/kitluy/identity"

  _kitluy_write_hardening "$root"
  _kitluy_write_units "$root"

  log "base composition applied"
}

# --- Security hardening -----------------------------------------------------
_kitluy_write_hardening() {
  local root="$1"
  install -d "${root}/etc/ssh/sshd_config.d"

  # No password login, no root login. A managed fleet device is not
  # administered by typing a password into it.
  cat > "${root}/etc/ssh/sshd_config.d/60-kitluy-hardening.conf" <<'EOF'
# KitLuy managed device hardening.
PermitRootLogin no
PasswordAuthentication no
ChallengeResponseAuthentication no
KbdInteractiveAuthentication no
PermitEmptyPasswords no
X11Forwarding no
EOF

  install -d "${root}/etc/sysctl.d"
  cat > "${root}/etc/sysctl.d/60-kitluy-hardening.conf" <<'EOF'
# KitLuy managed device hardening.
kernel.kptr_restrict=2
kernel.dmesg_restrict=1
net.ipv4.conf.all.rp_filter=1
net.ipv4.conf.all.accept_redirects=0
net.ipv6.conf.all.accept_redirects=0
net.ipv4.conf.all.accept_source_route=0
EOF
}

# --- systemd units ----------------------------------------------------------
_kitluy_write_units() {
  local root="$1"
  local unit_dir="${root}/etc/systemd/system"
  install -d "$unit_dir"

  # Firstboot: identity bootstrap. Ordered BEFORE enrollment because enrollment
  # has nothing to prove possession of until identity exists.
  #
  # RERUN SAFETY is a property of the agent, not of this unit: the unit has no
  # ConditionPathExists guard on purpose, so a half-completed firstboot is
  # retried instead of being permanently skipped by a marker file that was
  # written before the work finished.
  # Canonical units and bootstrap executables come from the shared overlay,
  # not from heredocs here. See kitluy_install_overlay in scripts/lib/common.sh.
  kitluy_install_overlay "$root" "${KITLUY_OS_IMAGE_ROOT}/rpi-image-gen/layer/kitluy-hub-base.rootfs-overlay"

  install -d "${root}/etc/systemd/journald.conf.d"
  cat > "${root}/etc/systemd/journald.conf.d/60-kitluy.conf" <<'EOF'
[Journal]
Storage=persistent
SystemMaxUse=256M
MaxRetentionSec=30day
EOF
}
