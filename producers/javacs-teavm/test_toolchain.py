"""Private-JDK regression tests; run with python3 producers/javacs-teavm/test_toolchain.py."""
import pathlib
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import toolchain


class PrivateTrustStoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.jdk = toolchain.pinned_jdk()

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='test-truststore-', dir=toolchain.CACHE)
        self.addCleanup(self.temporary.cleanup)
        self.directory = pathlib.Path(self.temporary.name)
        self.home = self.directory / 'jdk'
        (self.home / 'bin').mkdir(parents=True)
        (self.home / 'bin/java').symlink_to(self.jdk / 'bin/java')
        (self.home / 'lib/security').mkdir(parents=True)
        self.store = self.home / 'lib/security/cacerts'

    def assert_pinned_store(self):
        self.assertFalse(self.store.is_symlink())
        self.assertTrue(self.store.is_file())
        result = subprocess.run([str(self.jdk / 'bin/keytool'), '-list', '-keystore',
            str(self.store), '-storepass', 'changeit'], check=True, capture_output=True, text=True)
        self.assertEqual(result.stdout.count('trustedCertEntry'), toolchain.INPUTS['certificates']['count'])

    def test_repairs_link_to_absent_host_truststore(self):
        missing = self.directory / 'absent-host/etc/ssl/certs/java/cacerts'
        self.store.symlink_to(missing)
        toolchain.provision_truststore(self.home)
        self.assert_pinned_store()
        self.assertFalse(missing.exists())

    def test_replaces_external_link_without_modifying_its_target(self):
        external = self.directory / 'host-cacerts'
        external.write_bytes(b'host configuration must not change')
        self.store.symlink_to(external)
        toolchain.provision_truststore(self.home)
        self.assert_pinned_store()
        self.assertEqual(external.read_bytes(), b'host configuration must not change')

    def test_rebuilds_corrupt_cached_store(self):
        self.store.write_bytes(b'corrupt restored cache')
        toolchain.provision_truststore(self.home)
        self.assert_pinned_store()

    def test_modified_ca_download_fails_before_changing_existing_store(self):
        receipt = toolchain.INPUTS['certificates']['package']
        archive = toolchain.download(receipt)
        downloads = self.directory / 'downloads'
        downloads.mkdir()
        tampered = downloads / receipt['path']
        shutil.copyfile(archive, tampered)
        with tampered.open('ab') as output:
            output.write(b'tampered')
        self.store.write_bytes(b'existing private store')
        with patch.object(toolchain, 'CACHE', self.directory):
            with self.assertRaisesRegex(ValueError, 'Authenticated producer input differs'):
                toolchain.provision_truststore(self.home)
        self.assertEqual(self.store.read_bytes(), b'existing private store')


if __name__ == '__main__':
    unittest.main()
