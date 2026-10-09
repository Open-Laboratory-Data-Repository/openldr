/** Files the third-party image policy covers. The dev compose (docker-compose.yml) is left out
 *  on purpose: developers have its images cached and its mssql/mysql tags come from variables. */
export const POLICY_FILES = [
  'deploy/install/docker-compose.yml',
  'deploy/install/docker-compose.mssql.yml',
  'deploy/install/docker-compose.mysql.yml',
  'docker-compose.prod.yml',
  'apps/server/Dockerfile',
  'apps/studio/Dockerfile',
  'apps/web/Dockerfile',
  'deploy/nginx/Dockerfile',
  'deploy/keycloak/Dockerfile',
] as const;
