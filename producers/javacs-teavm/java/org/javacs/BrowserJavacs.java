package org.javacs;

import com.google.gson.*;
import java.io.IOException;
import java.net.URI;
import java.nio.file.*;
import org.javacs.lsp.BrowserDispatch;
import org.javacs.lsp.LanguageClient;
import org.javacs.lsp.PublishDiagnosticsParams;
import org.javacs.lsp.ShowMessageParams;
import org.teavm.jso.*;
import org.teavm.jso.typedarrays.Int8Array;
import org.wasmidle.javacs.BrowserPlatformIO;

/** Only browser transport and filesystem setup; requests run the upstream language server. */
@JSClass(name = "JavacsSession")
public final class BrowserJavacs {
    @JSFunctor
    public interface Output extends JSObject { void accept(String json); }
    @JSFunctor
    public interface HtmlFormatter extends JSObject { String apply(String html); }
    private static HtmlFormatter htmlFormatter;
    private static String startupStage;
    private final BrowserDispatch dispatcher;
    private final Path workspaceRoot;
    private boolean disposed;

    @JSExport
    public static BrowserJavacs createSession(String rootUri, String filesJson, Int8Array sdkArchive, Output output,
            HtmlFormatter htmlFormatter)
            throws IOException {
        BrowserJavacs.htmlFormatter = htmlFormatter;
        startupStage = "copy SDK archive";
        try {
            return new BrowserJavacs(rootUri, filesJson, sdkArchive, output);
        } catch (Throwable error) {
            error.printStackTrace();
            throw new IllegalStateException("javacs initialization (" + startupStage + "): "
                    + error.getClass().getName() + ": " + error.getMessage(), error);
        }
    }

    static String formatHtml(String html) {
        if (htmlFormatter == null) throw new IllegalStateException("Javadoc XML platform adapter is unavailable");
        return htmlFormatter.apply(html);
    }

    private BrowserJavacs(String rootUri, String filesJson, Int8Array sdkArchive, Output output) throws IOException {
        var bytes = new byte[sdkArchive.getLength()];
        for (int i = 0; i < bytes.length; i++) bytes[i] = sdkArchive.get(i);
        startupStage = "read SDK classes";
        BrowserFileManager.installSdk(bytes);
        startupStage = "resolve workspace URI";
        var root = Path.of(URI.create(rootUri)).toAbsolutePath().normalize();
        workspaceRoot = root;
        startupStage = "create workspace directory";
        BrowserPlatformIO.createDirectories(root);
        startupStage = "parse workspace snapshot";
        var files = new JsonParser().parse(filesJson).getAsJsonObject();
        for (var entry : files.entrySet()) {
            var file = root.resolve(entry.getKey()).normalize();
            if (!file.startsWith(root)) throw new IOException("Source path leaves the workspace");
            startupStage = "write initial source " + entry.getKey();
            BrowserPlatformIO.createDirectories(file.getParent());
            Files.writeString(file, entry.getValue().getAsString());
        }
        startupStage = "initialize protocol codec";
        final var gson = JsonHelper.GSON;
        var client = new LanguageClient() {
            private void notify(String method, Object params) {
                var message = new JsonObject();
                message.addProperty("jsonrpc", "2.0"); message.addProperty("method", method);
                message.add("params", gson.toJsonTree(params)); output.accept(message.toString());
            }
            public void publishDiagnostics(PublishDiagnosticsParams params) { notify("textDocument/publishDiagnostics", params); }
            public void showMessage(ShowMessageParams params) { notify("window/showMessage", params); }
            public void registerCapability(String method, JsonElement options) {
                var registration = new JsonObject(); registration.addProperty("id", "javacs-browser-watch");
                registration.addProperty("method", method); registration.add("registerOptions", options);
                notify("client/registerCapability", registration);
            }
            public void customNotification(String method, JsonElement params) { notify(method, params); }
        };
        startupStage = "construct original language server";
        dispatcher = new BrowserDispatch(new JavaLanguageServer(client), output::accept);
        startupStage = "ready";
    }

    @JSExport
    public void dispatch(String json) {
        if (disposed) throw new IllegalStateException("javacs session is disposed");
        var message = new JsonParser().parse(json).getAsJsonObject();
        var method = message.has("method") ? message.get("method").getAsString() : "";
        if (method.equals("textDocument/didOpen") || method.equals("textDocument/didSave")) {
            var document = message.getAsJsonObject("params").getAsJsonObject("textDocument");
            var uri = URI.create(document.get("uri").getAsString());
            if (!uri.getScheme().equals("file") || uri.getAuthority() != null || uri.getQuery() != null || uri.getFragment() != null) {
                throw new IllegalArgumentException("Only local workspace file URIs are supported");
            }
            var file = Path.of(uri).toAbsolutePath().normalize();
            if (!file.startsWith(workspaceRoot)) throw new IllegalArgumentException("Document URI leaves the workspace");
            if (method.equals("textDocument/didOpen") && !Files.exists(file)) {
                try {
                    BrowserPlatformIO.createDirectories(file.getParent());
                    Files.writeString(file, document.get("text").getAsString());
                    watch(uri, 1);
                } catch (IOException e) { throw new IllegalStateException("Cannot create source document", e); }
            } else if (method.equals("textDocument/didSave") && FileStore.activeDocuments().contains(file)) {
                try {
                    var existed = Files.exists(file);
                    BrowserPlatformIO.createDirectories(file.getParent());
                    Files.writeString(file, FileStore.contents(file));
                    watch(uri, existed ? 2 : 1);
                } catch (IOException e) { throw new IllegalStateException("Cannot save source document", e); }
            }
        }
        dispatcher.dispatch(json);
    }

    private void watch(URI uri, int type) {
        var change = new JsonObject(); change.addProperty("uri", uri.toASCIIString()); change.addProperty("type", type);
        var changes = new JsonArray(); changes.add(change);
        var params = new JsonObject(); params.add("changes", changes);
        var notification = new JsonObject(); notification.addProperty("jsonrpc", "2.0");
        notification.addProperty("method", "workspace/didChangeWatchedFiles"); notification.add("params", params);
        dispatcher.dispatch(notification.toString());
    }

    @JSExport
    public void dispose() { disposed = true; }
}
