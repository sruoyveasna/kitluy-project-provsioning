WHY /etc/systemd/system/postgresql.service IS A SYMLINK TO /dev/null

Debian's postgresql-15 package leaves `postgresql.service` ENABLED and ships a
cluster config at /etc/postgresql/15/main, but this image deliberately never
initialises that cluster's data directory (/var/lib/postgresql/15/main). So the
unit started on every boot, found nothing, and failed -- a permanent red line in
`systemctl --failed` that has nothing to do with the device's real state, and
which hides the failures that DO matter.

The Hub's database must not live on the boot card. `hub-database-provision` says
so directly: creating the cluster anywhere but inside the LUKS2 volume "would put
the Store's data in the clear". It creates and starts its own cluster on the
encrypted volume with `pg_ctl`, and never calls systemctl or the Debian unit --
so masking that unit changes no behaviour.

The real database is started by kitluy-hub-database.service, which requires
var-lib-kitluy-hub.mount, which requires kitluy-hub-storage.service. On a board
with no device-unique OTP key programmed, that chain correctly stops and there is
no local database. That is a hardware provisioning decision, not a fault.
