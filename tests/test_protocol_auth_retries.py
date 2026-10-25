"""Regression checks for OEM Hawk nonce reuse; runnable with stdlib unittest."""

from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest


BUNDLED = Path(__file__).resolve().parents[1] / "src" / "roborock_local_server" / "bundled_backend"
# Load the stdlib-only module without shared/__init__.py, which imports the
# complete server and its native dependencies. No auth behavior is mocked.
spec = importlib.util.spec_from_file_location("protocol_auth_retry_subject", BUNDLED / "shared" / "protocol_auth.py")
assert spec is not None and spec.loader is not None
subject = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = subject
spec.loader.exec_module(subject)
ProtocolAuthStore = subject.ProtocolAuthStore
build_hawk_authorization = subject.build_hawk_authorization


class HawkRetryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.snapshot = Path(self.directory.name) / "snapshot.json"
        self.snapshot.write_text(json.dumps({"user_data": {
            "token": "test-token", "rruid": "test-rruid",
            "rriot": {"u": "test-user", "s": "test-session", "h": "test-key", "k": "test-mqtt"},
        }}))
        self.store = ProtocolAuthStore(self.snapshot)
        self.user = self.store.availability().user
        self.assertIsNotNone(self.user)
        self.timestamp = 1_700_000_000
        self.received_at = self.timestamp + 0.125

    def request(self, *, method="GET", path="/user/scene/order", nonce="short",
                query=None, form=None, body=None):
        authorization = build_hawk_authorization(
            user=self.user, path=path, timestamp=self.timestamp, nonce=nonce,
            query_values=query, form_values=form, json_body=body,
        )
        return {
            "method": method, "path": path,
            "query_params": {key: [value] for key, value in (query or {}).items()},
            "body_params": ({"__json": [body.decode()]} if body is not None
                            else {key: [value] for key, value in (form or {}).items()}),
            "headers": {"authorization": authorization}, "raw_body": body,
        }

    def verify(self, request, *, after=0.0, store=None):
        return (store or self.store).verify_hawk(**request, now_ts=self.received_at + after)

    def test_different_paths_can_reuse_nonce(self):
        for path in ("/user/scene/order", "/user/inbox/latest", "/v4/user/homes/1"):
            self.assertEqual(self.verify(self.request(path=path)), (True, "ok"))

    def test_different_queries_can_reuse_nonce(self):
        for home in ("1", "2"):
            self.assertEqual(self.verify(self.request(query={"homeId": home})), (True, "ok"))

    def test_different_signed_form_writes_can_reuse_nonce(self):
        for enabled in ("true", "false"):
            request = self.request(method="PUT", form={"enabled": enabled})
            self.assertEqual(self.verify(request), (True, "ok"))
            self.assertEqual(self.verify(request, after=0.035), (False, "replayed_hawk_nonce"))

    def test_different_signed_json_writes_can_reuse_nonce(self):
        for body in (b'{"enabled":true}', b'{"enabled":false}'):
            request = self.request(method="POST", body=body)
            self.assertEqual(self.verify(request), (True, "ok"))
            self.assertEqual(self.verify(request, after=0.035), (False, "replayed_hawk_nonce"))

    def test_identical_reads_retry_for_ten_seconds_from_first_receipt(self):
        for method in ("GET", "HEAD"):
            with self.subTest(method=method):
                request = self.request(method=method, nonce=method)
                for delay in (0, 0.035, 5, 9.9, 10):
                    self.assertEqual(self.verify(request, after=delay), (True, "ok"))
                self.assertEqual(self.verify(request, after=10.001), (False, "replayed_hawk_nonce"))

    def test_retries_do_not_extend_the_window(self):
        request = self.request()
        for delay in (0, 9, 10):
            self.assertEqual(self.verify(request, after=delay), (True, "ok"))
        self.assertEqual(self.verify(request, after=11), (False, "replayed_hawk_nonce"))
        self.assertEqual(self.verify(request, after=19), (False, "replayed_hawk_nonce"))

    def test_identical_writes_and_unspecified_methods_remain_rejected(self):
        for method in ("POST", "PUT", "PATCH", "DELETE", "OPTIONS", ""):
            with self.subTest(method=method):
                request = self.request(method=method, nonce="write-" + method)
                self.assertEqual(self.verify(request), (True, "ok"))
                self.assertEqual(self.verify(request, after=0.035), (False, "replayed_hawk_nonce"))

    def test_signature_cannot_be_reused_across_methods(self):
        for first, second in (("GET", "POST"), ("POST", "GET"), ("GET", "HEAD"), ("HEAD", "GET")):
            with self.subTest(first=first, second=second):
                request = self.request(method=first, nonce=first + second)
                self.assertEqual(self.verify(request), (True, "ok"))
                self.assertEqual(self.verify({**request, "method": second}, after=0.035),
                                 (False, "replayed_hawk_nonce"))

    def test_missing_method_defaults_to_strict_replay_rejection(self):
        request = self.request()
        request.pop("method")
        self.assertEqual(self.verify(request), (True, "ok"))
        self.assertEqual(self.verify(request, after=0.035), (False, "replayed_hawk_nonce"))

    def test_bad_signatures_are_rejected_before_and_during_retry_window(self):
        request = self.request()
        bad = {**request, "headers": {"authorization": request["headers"]["authorization"].replace('mac="', 'mac="bad')}}
        self.assertEqual(self.verify(bad), (False, "invalid_hawk_mac"))
        self.assertEqual(self.verify(request), (True, "ok"))
        self.assertEqual(self.verify(bad, after=0.035), (False, "invalid_hawk_mac"))

    def test_changed_request_data_still_requires_a_matching_signature(self):
        request = self.request()
        self.assertEqual(self.verify(request), (True, "ok"))
        for changed in (
            {"path": "/user/inbox/latest"},
            {"query_params": {"homeId": ["2"]}},
            {"body_params": {"enabled": ["true"]}},
        ):
            with self.subTest(changed=changed):
                self.assertEqual(self.verify({**request, **changed}, after=0.035), (False, "invalid_hawk_mac"))

    def test_changed_json_body_still_requires_a_matching_signature(self):
        request = self.request(method="POST", body=b'{"enabled":true}')
        self.assertEqual(self.verify(request), (True, "ok"))
        changed = {**request, "raw_body": b'{"enabled":false}',
                   "body_params": {"__json": ['{"enabled":false}']}}
        self.assertEqual(self.verify(changed, after=0.035), (False, "invalid_hawk_mac"))

    def test_stale_timestamps_and_wrong_sessions_remain_rejected(self):
        request = self.request()
        self.assertEqual(self.verify(request, after=301), (False, "stale_hawk_timestamp"))
        wrong = {**request, "headers": {"authorization": request["headers"]["authorization"].replace(
            's="test-session"', 's="other-session"')}}
        self.assertEqual(self.verify(wrong), (False, "invalid_hawk_session"))

    def test_short_cache_ttl_does_not_allow_an_old_replay(self):
        store = ProtocolAuthStore(self.snapshot, hawk_nonce_ttl_seconds=1)
        request = self.request()
        self.assertEqual(self.verify(request, store=store), (True, "ok"))
        self.assertEqual(self.verify(request, store=store, after=11), (False, "replayed_hawk_nonce"))

    def test_future_timestamp_cannot_replay_at_last_valid_second(self):
        request = self.request()
        for now, expected in (
            (self.timestamp - 300, (True, "ok")),
            (self.timestamp + 300, (False, "replayed_hawk_nonce")),
            (self.timestamp + 301, (False, "stale_hawk_timestamp")),
        ):
            self.assertEqual(self.store.verify_hawk(**request, now_ts=now), expected)

    def test_concurrent_reads_retry_but_only_one_identical_write_is_accepted(self):
        for method in ("GET", "POST"):
            with self.subTest(method=method), ThreadPoolExecutor(max_workers=8) as pool:
                request = self.request(method=method, nonce="parallel-" + method)
                results = list(pool.map(lambda _: self.verify(request), range(32)))
                self.assertEqual(results.count((True, "ok")), 32 if method == "GET" else 1)
                self.assertTrue(all(result in ((True, "ok"), (False, "replayed_hawk_nonce")) for result in results))

    def test_clock_rollback_does_not_allow_a_retry(self):
        request = self.request()
        self.assertEqual(self.verify(request), (True, "ok"))
        self.assertEqual(self.verify(request, after=-1), (False, "replayed_hawk_nonce"))

    def test_read_retry_window_can_be_disabled(self):
        store = ProtocolAuthStore(self.snapshot, hawk_read_retry_seconds=0)
        request = self.request()
        self.assertEqual(self.verify(request, store=store), (True, "ok"))
        self.assertEqual(self.verify(request, store=store, after=0.035), (False, "replayed_hawk_nonce"))


if __name__ == "__main__":
    unittest.main()
