import { Plugin } from "obsidian";

export interface NotesData {
	[key: string]: string;
}

export class NotesManager {
	private plugin: Plugin;
	private data: NotesData = {};
	private saveQueue: Promise<void> | null = null;
	private isSaving: boolean = false;

	constructor(plugin: Plugin) {
		this.plugin = plugin;
	}

	async load(): Promise<void> {
		try {
			const loaded = await this.plugin.loadData();
			this.data = loaded || {};
		} catch (error) {
			console.error("Error loading notes data:", error);
			this.data = {};
		}
	}

	private async saveWithRetry(retries: number = 3): Promise<void> {
		let lastError: Error | null = null;
		
		for (let i = 0; i < retries; i++) {
			try {
				await this.plugin.saveData(this.data);
				return;
			} catch (error) {
				lastError = error as Error;
				// Wait a bit before retrying
				await new Promise(resolve => setTimeout(resolve, 100 * (i + 1)));
			}
		}
		
		if (lastError) {
			console.error("Failed to save notes after retries:", lastError);
			throw lastError;
		}
	}

	async save(): Promise<void> {
		// If there's already a save in progress, queue this one
		if (this.isSaving) {
			if (!this.saveQueue) {
				this.saveQueue = new Promise<void>(async (resolve) => {
					await this.saveWithRetry();
					this.isSaving = false;
					this.saveQueue = null;
					resolve();
				});
			}
			return this.saveQueue;
		}

		this.isSaving = true;
		try {
			await this.saveWithRetry();
		} finally {
			this.isSaving = false;
		}
	}

	getNote(key: string): string {
		try {
			return this.data[key] || "";
		} catch (error) {
			console.error("Error getting note:", error);
			return "";
		}
	}

	async setNote(key: string, note: string): Promise<void> {
		try {
			// Only save if the note has actually changed
			if (this.data[key] !== note) {
				this.data[key] = note;
				await this.save();
			}
		} catch (error) {
			console.error("Error setting note:", error);
			throw error;
		}
	}

	// Removes notes for the specified slider that are not in the validFiles list.
	async cleanupNotesForSlider(sliderId: string, validFiles: string[]): Promise<void> {
		try {
			let hasChanges = false;
			const keysToDelete: string[] = [];

			// First, collect all keys that need to be deleted
			for (const key of Object.keys(this.data)) {
				if (key.startsWith(`${sliderId}-`)) {
					const mediaFile = key.substring(sliderId.length + 1);
					if (!validFiles.includes(mediaFile)) {
						keysToDelete.push(key);
						hasChanges = true;
					}
				}
			}

			// Then delete them all at once
			if (hasChanges) {
				for (const key of keysToDelete) {
					delete this.data[key];
				}
				await this.save();
			}
		} catch (error) {
			console.error("Error cleaning up notes:", error);
			throw error;
		}
	}

	// Add method to clear all notes (useful for debugging or reset)
	async clearAllNotes(): Promise<void> {
		try {
			this.data = {};
			await this.save();
		} catch (error) {
			console.error("Error clearing notes:", error);
			throw error;
		}
	}
}
