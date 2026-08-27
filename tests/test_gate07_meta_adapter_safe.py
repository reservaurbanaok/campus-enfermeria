import hashlib
import hmac
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ADAPTER_ROOT = ROOT / 'integrations' / 'n8n' / 'whatsapp'
sys.path.insert(0, str(ADAPTER_ROOT))

from ingress_proxy import proxy
from wf04_meta_adapter import (
    EXPECTED_PHONE_NUMBER_ID,
    MetaAdapterError,
    build_meta_outbound,
    build_omega_request,
    parse_meta_payload,
    verify_meta_signature,
)

FIXTURES = ADAPTER_ROOT / 'fixtures' / 'wf04'


class Gate07MetaAdapterSafeTests(unittest.TestCase):
    @staticmethod
    def fixture(name):
        return json.loads((FIXTURES / f'{name}.json').read_text(encoding='utf-8'))

    def test_meta_signature_and_normalization(self):
        raw = json.dumps(self.fixture('01-inbound-text'), ensure_ascii=False, separators=(',', ':')).encode()
        signature = 'sha256=' + hmac.new(b'synthetic-meta-secret', raw, hashlib.sha256).hexdigest()
        self.assertTrue(verify_meta_signature(raw, signature, 'synthetic-meta-secret'))
        self.assertFalse(verify_meta_signature(raw, 'sha256=' + '0' * 64, 'synthetic-meta-secret'))
        self.assertTrue(proxy.verify_meta_signature(raw, signature, 'synthetic-meta-secret'))
        event = parse_meta_payload(self.fixture('01-inbound-text'))[0]
        self.assertEqual(event['kind'], 'text')
        self.assertEqual(event['schema_version'], 'OMEGA_CHANNEL_MESSAGE_V1')
        self.assertEqual(event['channel_metadata']['phone_number_id'], EXPECTED_PHONE_NUMBER_ID)

    def test_malformed_status_and_unsupported_are_controlled(self):
        with self.assertRaises(MetaAdapterError):
            parse_meta_payload(self.fixture('07-malformed-payload'))
        with self.assertRaisesRegex(MetaAdapterError, 'Phone Number'):
            parse_meta_payload(self.fixture('08-wrong-phone-number-id'))
        unsupported = parse_meta_payload(self.fixture('09-unsupported-image'))[0]
        self.assertEqual(unsupported['kind'], 'unsupported')
        self.assertNotIn('text', unsupported)

    def test_signed_channel_request_and_outbound_shape_are_side_effect_free(self):
        event = parse_meta_payload(self.fixture('01-inbound-text'))[0]
        body, headers = build_omega_request(event, secret='synthetic-channel-secret', timestamp='1700000000', nonce='nonce-1')
        expected = hmac.new(b'synthetic-channel-secret', b'1700000000\nnonce-1\n' + body, hashlib.sha256).hexdigest()
        self.assertEqual(headers['X-Omega-Signature'], expected)
        self.assertEqual(json.loads(body)['schema_version'], 'OMEGA_CHANNEL_MESSAGE_V1')
        outbound = build_meta_outbound(phone_number_id=EXPECTED_PHONE_NUMBER_ID, recipient='5491100000000', response_text='Respuesta sintética', access_token='synthetic-token', capture_base_url='http://127.0.0.1:9999')
        self.assertEqual(outbound['method'], 'POST')
        self.assertEqual(outbound['json']['type'], 'text')
        self.assertEqual(outbound['graph_url'].split('/v25.0/')[0], 'https://graph.facebook.com')

    def test_wf04_contract_targets_configured_campus_ingress(self):
        workflow = json.loads((ADAPTER_ROOT / 'workflows' / 'WF-04-whatsapp-inbound-real.json').read_text(encoding='utf-8'))
        names = {node['name'] for node in workflow['nodes']}
        self.assertIn('Parse Meta And Normalize', names)
        self.assertIn('Sign OMEGA Channel Request', names)
        self.assertIn('OMEGA Channel Ingress V1', names)
        self.assertEqual(workflow['settings']['errorWorkflow'], 'gate07-wf03-v1')
        omega_node = next(node for node in workflow['nodes'] if node['name'] == 'OMEGA Channel Ingress V1')
        self.assertIn('OMEGA_CHANNEL_INGRESS_URL', omega_node['parameters']['url'])
        self.assertNotIn('netroomdigital.com', json.dumps(workflow).lower())


if __name__ == '__main__':
    unittest.main()
