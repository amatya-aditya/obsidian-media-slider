export async function compressImage(
	imageUrl: string,
	maxWidth: number = 800,
	maxHeight: number = 600,
	quality: number = 0.7
): Promise<string> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		// To support images from other domains, set crossOrigin.
		img.crossOrigin = "Anonymous";
		img.onload = () => {
			let { width, height } = img;
			let newWidth = width;
			let newHeight = height;

			// Calculate the scaling factor.
			if (width > maxWidth || height > maxHeight) {
				const widthRatio = maxWidth / width;
				const heightRatio = maxHeight / height;
				const ratio = Math.min(widthRatio, heightRatio);
				newWidth = width * ratio;
				newHeight = height * ratio;
			}

			// Create a canvas and draw the resized image.
			const canvas = document.createElement("canvas");
			canvas.width = newWidth;
			canvas.height = newHeight;
			const ctx = canvas.getContext("2d");
			if (!ctx) {
				reject("Canvas context not available");
				return;
			}
			ctx.drawImage(img, 0, 0, newWidth, newHeight);
			const dataUrl = canvas.toDataURL("image/jpeg", quality);
			resolve(dataUrl);
		};
		img.onerror = (err) => reject(err);
		img.src = imageUrl;
	});
}
