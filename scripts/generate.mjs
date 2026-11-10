// Seeded synthetic crypto inventory for a mid-size bank: 36 systems grouped from a Command-style
// certificate inventory (TLS, mTLS, VPN, S/MIME, code signing, PKI hierarchy, HSMs, partner B2B).
// Each system carries what a PQC migration plan needs: algorithm, certificate count, usage
// (key establishment vs signature), protection lifetime X (years the data or trust must hold),
// a value weight, migration effort, dependencies, and vendor PQC-readiness dates.
// Usage: node scripts/generate.mjs [seed] -> data/inventory.json
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// id, name, category, use, algo, certs, X (years protection must hold), sensitivity 1-3,
// exposure 1-3 (external), criticality 1-3, regulatory 1-3, effort (engineer-weeks), deps, vendorReady (years from plan start)
const BASE = [
  ['hsm-fw', 'HSM firmware (PQC-capable)', 'PKI', 'sig', 'RSA-3072', 6, 0, 2, 1, 3, 3, 6, [], 0.25],
  ['root-ca', 'Offline root CA (hybrid ML-DSA)', 'PKI', 'sig', 'RSA-4096', 1, 12, 3, 1, 3, 3, 10, ['hsm-fw'], 0],
  ['issuing-tls', 'Issuing CA: TLS', 'PKI', 'sig', 'RSA-2048', 1, 4, 3, 2, 3, 3, 6, ['root-ca'], 0],
  ['issuing-dev', 'Issuing CA: devices', 'PKI', 'sig', 'RSA-2048', 1, 8, 2, 1, 3, 2, 6, ['root-ca'], 0],
  ['issuing-user', 'Issuing CA: users & S/MIME', 'PKI', 'sig', 'RSA-2048', 1, 5, 2, 1, 2, 2, 5, ['root-ca'], 0],
  ['ocsp', 'OCSP responders', 'PKI', 'sig', 'ECDSA P-256', 4, 0, 1, 3, 3, 2, 3, ['issuing-tls'], 0],
  ['web-portal', 'Customer web banking (TLS)', 'External TLS', 'kex', 'ECDHE P-256', 38, 7, 3, 3, 3, 3, 8, [], 0.5],
  ['mobile-api', 'Mobile banking API gateway', 'External TLS', 'kex', 'ECDHE P-256', 22, 7, 3, 3, 3, 3, 10, [], 0.75],
  ['payments-gw', 'Card payments gateway', 'External TLS', 'kex', 'ECDHE P-256', 16, 10, 3, 3, 3, 3, 12, ['hsm-fw'], 0.5],
  ['open-banking', 'Open banking (PSD2/FDX) APIs', 'External TLS', 'kex', 'ECDHE P-256', 14, 7, 3, 3, 2, 3, 9, [], 0.75],
  ['marketing-cdn', 'Marketing site & CDN', 'External TLS', 'kex', 'ECDHE X25519', 41, 0.1, 1, 3, 1, 1, 3, [], 0],
  ['status-page', 'Status page', 'External TLS', 'kex', 'ECDHE X25519', 3, 0.05, 1, 3, 1, 1, 1, [], 0],
  ['partner-b2b', 'Partner B2B (AS2/SFTP)', 'B2B', 'kex', 'RSA-2048', 27, 10, 3, 3, 2, 3, 14, [], 1.25],
  ['swift-gw', 'Interbank messaging gateway', 'B2B', 'kex', 'RSA-2048', 6, 10, 3, 2, 3, 3, 16, ['hsm-fw'], 1.5],
  ['remote-vpn', 'Remote-access VPN (IKEv2)', 'Network', 'kex', 'ECDH P-384', 4, 5, 3, 3, 2, 2, 7, [], 0.5],
  ['site-vpn', 'Site-to-site VPN (branches)', 'Network', 'kex', 'DH group 14', 112, 7, 3, 3, 3, 2, 12, [], 1.0],
  ['wifi-8021x', 'Corporate Wi-Fi (802.1X EAP-TLS)', 'Network', 'kex', 'RSA-2048', 1800, 1, 1, 2, 2, 1, 6, ['issuing-dev'], 0.5],
  ['core-banking', 'Core banking DB replication (TLS)', 'Internal', 'kex', 'RSA-2048', 12, 25, 3, 1, 3, 3, 14, ['issuing-tls'], 0.75],
  ['data-lake', 'Data lake ingestion (Kafka mTLS)', 'Internal', 'kex', 'ECDHE P-256', 64, 15, 3, 1, 2, 3, 10, ['issuing-tls'], 0.25],
  ['mesh', 'Service mesh mTLS', 'Internal', 'kex', 'ECDHE P-256', 940, 2, 2, 1, 3, 2, 12, ['issuing-tls'], 0.25],
  ['backup-wrap', 'Backup key wrapping', 'Internal', 'kex', 'RSA-OAEP 2048', 9, 30, 3, 1, 3, 3, 8, ['hsm-fw'], 0],
  ['hr-system', 'HR & payroll SaaS connector', 'Internal', 'kex', 'ECDHE P-256', 5, 30, 3, 2, 2, 3, 4, [], 0.5],
  ['ldap', 'Directory (LDAPS)', 'Internal', 'kex', 'RSA-2048', 8, 3, 2, 1, 3, 2, 4, ['issuing-tls'], 0],
  ['smime', 'Email encryption (S/MIME)', 'Email', 'kex', 'RSA-2048', 5200, 20, 3, 2, 2, 3, 15, ['issuing-user'], 1.75],
  ['mail-tls', 'Mail transport (SMTP STARTTLS)', 'Email', 'kex', 'ECDHE P-256', 10, 3, 2, 3, 2, 2, 3, [], 0.25],
  ['atm-fw', 'ATM firmware signing', 'Code signing', 'sig', 'RSA-2048', 3, 12, 3, 2, 3, 3, 10, ['issuing-dev', 'hsm-fw'], 1.0],
  ['card-personal', 'Card personalization keys', 'Code signing', 'sig', 'RSA-2048', 4, 8, 3, 1, 3, 3, 9, ['hsm-fw'], 1.25],
  ['app-signing', 'Mobile app & release signing', 'Code signing', 'sig', 'ECDSA P-256', 4, 3, 2, 3, 3, 2, 4, [], 0.5],
  ['doc-signing', 'Customer document e-signing', 'Code signing', 'sig', 'RSA-3072', 2, 15, 3, 3, 2, 3, 7, ['issuing-user'], 0.75],
  ['iot-branch', 'Branch IoT sensors (device certs)', 'Devices', 'sig', 'ECDSA P-256', 4300, 10, 1, 2, 1, 1, 9, ['issuing-dev'], 1.5],
  ['pos-terminals', 'Merchant POS terminals', 'Devices', 'kex', 'RSA-2048', 3100, 6, 3, 3, 2, 3, 13, ['issuing-dev'], 1.25],
  ['ssh-bastion', 'SSH bastions & admin keys', 'Admin', 'kex', 'RSA-2048', 640, 1, 2, 2, 3, 2, 5, [], 0.25],
  ['k8s-api', 'Kubernetes control planes', 'Admin', 'sig', 'ECDSA P-256', 28, 0.5, 2, 1, 3, 2, 3, ['issuing-tls'], 0],
  ['ci-runners', 'CI runners & artifact registry', 'Admin', 'sig', 'ECDSA P-256', 46, 1, 2, 2, 2, 1, 3, ['issuing-tls'], 0],
  ['print', 'Printers & scanners', 'Devices', 'kex', 'RSA-2048', 380, 0.5, 1, 1, 1, 1, 4, ['issuing-dev'], 2.0],
  ['legacy-mainframe', 'Mainframe batch transfer (TLS 1.2)', 'Internal', 'kex', 'RSA-2048', 4, 25, 3, 1, 3, 3, 18, ['issuing-tls'], 2.25],
];

export function generate(seed = 20261110) {
  const u = mulberry32(seed);
  const jitter = (x, f) => x * (1 + f * (2 * u() - 1));
  const systems = BASE.map(([id, name, category, use, algo, certs, X, sens, expo, crit, reg, effort, deps, vendorReady]) => {
    // value weight: sensitivity x exposure-adjusted traffic share (synthetic)
    const traffic = jitter(expo === 3 ? 3 : expo === 2 ? 1.6 : 1, 0.3);
    const value = Math.round(sens * sens * traffic * (use === 'sig' ? 1.4 : 1) * 10) / 10;
    return { id, name, category, use, algorithm: algo, certificates: certs, protectYears: X,
      sensitivity: sens, exposure: expo, criticality: crit, regulatory: reg,
      effortWeeks: Math.round(jitter(effort, 0.15) * 10) / 10, dependsOn: deps, vendorReadyYears: vendorReady, value };
  });
  return {
    seed, organization: 'Larkspur Federal Bank', planStart: '2027-01-01', capacityWeeksPerWeek: 1,
    note: 'effortWeeks = engineer-weeks of migration work; capacity = engineer-weeks completed per calendar week (one dedicated engineer = 1).',
    systems,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const data = generate(Number(process.argv[2] || 20261110));
  const json = JSON.stringify(data, null, 1);
  writeFileSync(new URL('../data/inventory.json', import.meta.url), json);
  const h = createHash('sha256').update(json).digest('hex').slice(0, 16);
  const eff = data.systems.reduce((t, s) => t + s.effortWeeks, 0);
  console.log(`wrote data/inventory.json: ${data.systems.length} systems, ${data.systems.reduce((t, s) => t + s.certificates, 0)} certificates, ${eff.toFixed(1)} engineer-weeks, sha256 ${h}`);
}
