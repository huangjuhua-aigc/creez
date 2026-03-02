const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { BrowserWindow, dialog } = require("electron");
const { CHANNELS } = require("./channels.cjs");
const { stripBuiltinSkillFlags } = require("./builtinSkillIds.cjs");

function ok(data) {
  return { ok: true, data };
}

function err(code, message, details) {
  return { ok: false, error: { code, message, details } };
}

function resolveAssistantConfigId(payload, contactRepository) {
  const raw = payload && typeof payload === "object" ? payload : {};
  if (raw.assistantConfigId != null) {
    const id = Number(raw.assistantConfigId);
    if (Number.isFinite(id) && id > 0) return id;
  }
  if (raw.contactId && contactRepository && typeof contactRepository.getById === "function") {
    const contact = contactRepository.getById(String(raw.contactId));
    if (contact?.assistantConfigId != null) {
      const id = Number(contact.assistantConfigId);
      if (Number.isFinite(id) && id > 0) return id;
    }
  }
  return 1;
}

function inferExtFromDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") return ".png";
  if (dataUrl.startsWith("data:image/jpeg")) return ".jpg";
  if (dataUrl.startsWith("data:image/webp")) return ".webp";
  if (dataUrl.startsWith("data:image/gif")) return ".gif";
  return ".png";
}

function toSafeFilename(name) {
  return String(name || "avatar")
    .replace(/[^\w.-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80);
}

async function saveAvatarFromDataUrl(payload, avatarDir) {
  const dataUrl = payload?.dataUrl;
  if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
    throw new Error("Invalid avatar payload.");
  }

  const matched = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
  if (!matched) throw new Error("Invalid avatar data URL format.");

  const ext = inferExtFromDataUrl(dataUrl);
  const baseName = toSafeFilename(payload?.fileName || `avatar_${Date.now()}`);
  const dir = avatarDir || path.join(os.homedir(), ".creez", "avatars");
  const targetPath = path.join(dir, `${baseName}${ext}`);

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(targetPath, Buffer.from(matched[1], "base64"));
  return targetPath;
}

function registerSettingsIpc(ipcMain, assistantConfigRepository, memoryStore, skillManager, contactRepository, options = {}) {
  const creezHome = options.creezHome ?? os.homedir();
  const avatarDir = path.join(creezHome, ".creez", "avatars");
  ipcMain.handle(CHANNELS.SETTINGS_GET_ASSISTANT_CONFIG, async (_event, payload) => {
    try {
      const assistantConfigId = resolveAssistantConfigId(payload, contactRepository);
      const config = assistantConfigRepository.getConfigById(assistantConfigId);
      if (!config) {
        return err("NOT_FOUND", "Assistant config not found.");
      }
      return ok(config);
    } catch (error) {
      return err("DB_ERROR", "Failed to read assistant config", error?.message || String(error));
    }
  });

  ipcMain.handle(CHANNELS.SETTINGS_GET_MODEL_API_KEY, async (_event, payload) => {
    const modelId = payload?.modelId;
    if (!modelId || typeof modelId !== "string") {
      return err("VALIDATION_ERROR", "modelId is required.");
    }
    try {
      const assistantConfigId = resolveAssistantConfigId(payload, contactRepository);
      const apiKey = assistantConfigRepository.getModelApiKeyFromConfig(assistantConfigId, modelId);
      return ok({ modelId, apiKey });
    } catch (error) {
      return err("DB_ERROR", "Failed to read model API key", error?.message || String(error));
    }
  });

  ipcMain.handle(CHANNELS.SETTINGS_SAVE_ASSISTANT_CONFIG, async (_event, payload) => {
    if (!payload || typeof payload !== "object") {
      return err("VALIDATION_ERROR", "Payload must be an object.");
    }
    try {
      const assistantConfigId = resolveAssistantConfigId(payload, contactRepository);
      if (assistantConfigId !== 1) {
        return err("FORBIDDEN", "Only the default assistant config can be edited by the user.");
      }
      const sanitizedPayload = { ...payload };
      if (sanitizedPayload.skills && typeof sanitizedPayload.skills === "object") {
        sanitizedPayload.skills = stripBuiltinSkillFlags(sanitizedPayload.skills);
      }
      const saved = assistantConfigRepository.saveConfigById(assistantConfigId, sanitizedPayload);
      if (skillManager && saved?.skills && typeof saved.skills === "object") {
        await skillManager.syncEnabledSkills(saved.skills);
      }
      // Temporary: when user updates model config, sync the same models to all other bots (e.g. RoundCloser).
      if (Array.isArray(payload.models) && contactRepository?.getNonDefaultBotAssistantConfigIds) {
        const otherConfigIds = contactRepository.getNonDefaultBotAssistantConfigIds();
        for (const configId of otherConfigIds) {
          assistantConfigRepository.saveConfigById(configId, { models: saved.models });
        }
      }
      return ok({ updated: true, updatedAt: Math.floor(Date.now() / 1000), config: saved });
    } catch (error) {
      return err("DB_ERROR", "Failed to save assistant config", error?.message || String(error));
    }
  });

  ipcMain.handle(CHANNELS.SETTINGS_UPLOAD_AVATAR, async (_event, payload) => {
    try {
      const assistantConfigId = resolveAssistantConfigId(payload, contactRepository);
      if (assistantConfigId !== 1) {
        return err("FORBIDDEN", "Only the default assistant config avatar can be changed by the user.");
      }
      const avatarPath = await saveAvatarFromDataUrl(payload, avatarDir);
      const saved = assistantConfigRepository.saveConfigById(assistantConfigId, { avatar: avatarPath });
      return ok({ avatarPath, config: saved });
    } catch (error) {
      return err("FS_ERROR", "Failed to upload avatar", error?.message || String(error));
    }
  });

  ipcMain.handle(CHANNELS.SETTINGS_SELECT_WORKPLACE_DIRECTORY, async (event) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender) || null;
      const result = await dialog.showOpenDialog(window, {
        title: "Select workplace directory",
        properties: ["openDirectory"],
      });
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return ok({ path: null });
      }
      return ok({ path: result.filePaths[0] });
    } catch (error) {
      return err("FS_ERROR", "Failed to select workplace directory", error?.message || String(error));
    }
  });

  ipcMain.handle(CHANNELS.SETTINGS_READ_IMAGE_DATA_URL, async (_event, payload) => {
    try {
      const imagePath = payload?.path;
      if (!imagePath || typeof imagePath !== "string") {
        return err("VALIDATION_ERROR", "path is required.");
      }
      const buffer = await fs.readFile(imagePath);
      const lower = imagePath.toLowerCase();
      const mime = lower.endsWith(".jpg") || lower.endsWith(".jpeg")
        ? "image/jpeg"
        : lower.endsWith(".webp")
          ? "image/webp"
          : lower.endsWith(".gif")
            ? "image/gif"
            : lower.endsWith(".bmp")
              ? "image/bmp"
              : "image/png";
      const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
      return ok({ dataUrl });
    } catch (error) {
      return err("FS_ERROR", "Failed to read image file", error?.message || String(error));
    }
  });

  ipcMain.handle(CHANNELS.SETTINGS_LIST_AVAILABLE_SKILLS, async () => {
    try {
      if (!skillManager) return ok({ items: [] });
      const items = await skillManager.listAvailableSkills();
      return ok({ items });
    } catch (error) {
      return err("FS_ERROR", "Failed to list available skills", error?.message || String(error));
    }
  });

  ipcMain.handle(CHANNELS.MEMORY_READ, async (_event, payload) => {
    try {
      const data = await memoryStore.read(payload?.path);
      return ok(data);
    } catch (error) {
      return err("FS_ERROR", "Failed to read memory file", error?.message || String(error));
    }
  });

  ipcMain.handle(CHANNELS.MEMORY_WRITE, async (_event, payload) => {
    if (!payload || typeof payload !== "object") {
      return err("VALIDATION_ERROR", "Payload must be an object.");
    }
    if (typeof payload.content !== "string") {
      return err("VALIDATION_ERROR", "content must be a string.");
    }
    try {
      const data = await memoryStore.write(payload.content, payload.path);
      return ok(data);
    } catch (error) {
      return err("FS_ERROR", "Failed to write memory file", error?.message || String(error));
    }
  });
}

module.exports = {
  registerSettingsIpc,
  saveAvatarFromDataUrl,
};
