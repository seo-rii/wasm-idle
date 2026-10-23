import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.cert.CertificateFactory;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

/** Bootstrap-only: standard JDK APIs import the authenticated Mozilla CA bundle. */
final class BuildTrustStore {
    public static void main(String[] args) throws Exception {
        var certificates = Path.of(args[0]);
        var destination = Path.of(args[1]);
        int expected = Integer.parseInt(args[2]);
        var factory = CertificateFactory.getInstance("X.509");
        var store = KeyStore.getInstance("JKS");
        store.load(null, null);
        try (var paths = Files.list(certificates)) {
            for (var path : paths.sorted().toList()) {
                try (var input = Files.newInputStream(path)) {
                    store.setCertificateEntry(path.getFileName().toString(), factory.generateCertificate(input));
                }
            }
        }
        if (store.size() != expected) throw new IllegalStateException("CA import count differs");
        char[] password = "changeit".toCharArray();
        try (var output = Files.newOutputStream(destination)) {
            store.store(output, password);
        }
        // Check the bytes actually written and the Java TLS provider's accepted
        // trust anchors before replacing the JRE's missing/host-dependent link.
        try (var input = Files.newInputStream(destination)) {
            store.load(input, password);
        }
        var managers = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        managers.init(store);
        int accepted = 0;
        for (var manager : managers.getTrustManagers()) {
            if (manager instanceof X509TrustManager x509) accepted += x509.getAcceptedIssuers().length;
        }
        if (accepted != expected) throw new IllegalStateException("TLS trust anchor count differs");
        System.out.println("Private producer TLS truststore: " + expected + " pinned Mozilla CA certificates");
    }
}
