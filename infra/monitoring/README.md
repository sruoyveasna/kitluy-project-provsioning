# Monitoring and alerting contracts

Independent-observability rule (OWNER-LOCKED KL-INF-P1-025): core monitoring
and alerts must not depend on the Admin Portal. Required signal families:
traffic, compute, database, queues, store-edge, files, AI (infra spec §17.2).
Store Hub metrics (Hub spec §16.2): hub_uptime_seconds, hub_sync_outbox_depth,
hub_sync_oldest_pending_seconds, hub_certificate_days_remaining,
hub_release_version, hub_config_version. SLO numbers are [REQUIRED].
