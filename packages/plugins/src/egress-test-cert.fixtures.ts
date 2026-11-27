// Test only. A self-signed certificate for 127.0.0.1 and its key, made for the egress tests with
// openssl on 2026-11-27, valid for 100 years. Nothing trusts it and it guards nothing: the tests
// use it to stand up an HTTPS server that Node must refuse.
export const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIBkDCCATagAwIBAgIUP9nHZE0TiEebfmtxsnSMouJwmBgwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJMTI3LjAuMC4xMCAXDTI2MTEyNzE0MzA0NVoYDzIxMjYxMTAz
MTQzMDQ1WjAUMRIwEAYDVQQDDAkxMjcuMC4wLjEwWTATBgcqhkjOPQIBBggqhkjO
PQMBBwNCAASdjIgiEtlaxG5IrZo2g/bTZZcj0oG0Nfs89mrgYR0kT+CK0l70bM5u
JBydYbRNrJo9uRb87RXiCGuV7fqQKhffo2QwYjAdBgNVHQ4EFgQUHPbnxdk1BvR7
e90ZBAWg9jYGmdEwHwYDVR0jBBgwFoAUHPbnxdk1BvR7e90ZBAWg9jYGmdEwDwYD
VR0TAQH/BAUwAwEB/zAPBgNVHREECDAGhwR/AAABMAoGCCqGSM49BAMCA0gAMEUC
IQDpjBAbbT7GQMbotIrJqSoQowWH94jH+lmx7WTUcL4+XgIgY8PaO6b/2Y+06zkQ
xcG8ctx00uRAklKUkvlhzCz/RW8=
-----END CERTIFICATE-----`;

export const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgPQ626ftSYkvMqtGs
yWlbtXRiJtMdjXTsdjiInSxyw1OhRANCAASdjIgiEtlaxG5IrZo2g/bTZZcj0oG0
Nfs89mrgYR0kT+CK0l70bM5uJBydYbRNrJo9uRb87RXiCGuV7fqQKhff
-----END PRIVATE KEY-----`;
