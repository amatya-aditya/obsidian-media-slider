import { Plugin } from "obsidian";

export interface NotesData {
	[key: string]: string;
}

export class NotesManager {
	private plugin: Plugin;
	private data: NotesData = {};

	constructor(plugin: Plugin) {
		this.plugin = plugin;
	}

	async load(): Promise<void> {
		const loaded = await this.plugin.loadData();
		this.data = loaded || {};
	}

	async save(): Promise<void> {
		await this.plugin.saveData(this.data);
	}

	getNote(key: string): string {
		return this.data[key] || "";
	}

	async setNote(key: string, note: string): Promise<void> {
		this.data[key] = note;
		await this.save();
	}

	// Removes notes for the specified slider that are not in the validFiles list.
	async cleanupNotesForSlider(sliderId: string, validFiles: string[]): Promise<void> {
		for (const key of Object.keys(this.data)) {
			if (key.startsWith(`${sliderId}-`)) {
				// Extract the media file portion from the key.
				const mediaFile = key.substring(sliderId.length + 1);
				if (!validFiles.includes(mediaFile)) {
					delete this.data[key];
				}
			}
		}
		await this.save();
	}
}
