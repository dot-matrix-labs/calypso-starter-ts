import { describe, expect, test } from 'vitest';

import { buildKubeconfig } from '../../../../scripts/gcp/deploy';

describe('Deploy pure functions', () => {
  test('buildKubeconfig produces valid YAML with token, CA data, and namespace', () => {
    const result = buildKubeconfig({
      namespace: 'calypso-prod',
      token: 'deploy-token-abc',
      caData: 'base64-ca-data',
    });

    expect(result).toContain('apiVersion: v1');
    expect(result).toContain('kind: Config');
    expect(result).toContain('server: https://localhost:6443');
    expect(result).toContain('certificate-authority-data: base64-ca-data');
    expect(result).toContain('namespace: calypso-prod');
    expect(result).toContain('token: deploy-token-abc');
    expect(result).toContain('current-context: deploy');
  });

  test('buildKubeconfig embeds different values correctly', () => {
    const result = buildKubeconfig({
      namespace: 'calypso-staging',
      token: 'other-token',
      caData: 'other-ca',
    });

    expect(result).toContain('namespace: calypso-staging');
    expect(result).toContain('token: other-token');
    expect(result).toContain('certificate-authority-data: other-ca');
  });
});
