class GmailCompositeClient {
  constructor({ repository, nativeClient, gogClient } = {}) {
    this.repository = repository;
    this.nativeClient = nativeClient;
    this.gogClient = gogClient;
  }

  active() {
    const account = this.repository?.getAccount?.();
    return account?.provider === "gog" ? this.gogClient : this.nativeClient;
  }

  getStatus() {
    const account = this.repository?.getAccount?.();
    if (account?.provider === "gog") return this.gogClient.getStatus();
    return this.nativeClient.getStatus();
  }

  ensureAccessToken() {
    const client = this.active();
    return typeof client.ensureAccessToken === "function" ? client.ensureAccessToken() : Promise.resolve("gog");
  }

  listMessages(args) {
    return this.active().listMessages(args);
  }

  readMessage(args) {
    return this.active().readMessage(args);
  }

  sendMessage(args) {
    return this.active().sendMessage(args);
  }
}

module.exports = {
  GmailCompositeClient,
};
