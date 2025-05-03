export interface CompareOptions {
    orientation: "horizontal" | "vertical";
    initialPosition?: number; // 0-100 as percentage
    showLabels?: boolean;
    label1?: string;
    label2?: string;
    swapImages?: boolean;
    enabled?: boolean;
}

export class CompareMode {
    private container: HTMLElement;
    private img1: string;
    private img2: string;
    private caption1: string | null;
    private caption2: string | null;
    private options: CompareOptions;
    private element: HTMLElement | null = null;
    private slider: HTMLElement | null = null;

    constructor(
        container: HTMLElement,
        img1: string,
        img2: string,
        caption1: string | null = null,
        caption2: string | null = null,
        options: CompareOptions = { orientation: "vertical" }
    ) {
        this.container = container;
        this.img1 = img1;
        this.img2 = img2;
        this.caption1 = caption1;
        this.caption2 = caption2;
        this.options = {
            orientation: options.orientation || "vertical",
            initialPosition: options.initialPosition || 50,
            showLabels: options.showLabels !== undefined ? options.showLabels : false,
            label1: options.label1 || "Before",
            label2: options.label2 || "After",
            swapImages: options.swapImages || false,
            enabled: options.enabled !== undefined ? options.enabled : true
        };
    }

    public render(): HTMLElement {
        // Create main container
        const compareContainer = document.createElement("div");
        compareContainer.className = "media-slider-compare-container";
        
        // Set orientation class
        compareContainer.classList.add(
            this.options.orientation === "vertical" 
                ? "compare-vertical" 
                : "compare-horizontal"
        );

        // Set the initial position as a CSS variable
        compareContainer.style.setProperty('--compare-position', `${this.options.initialPosition}%`);

        // Create image containers
        const imgContainer = document.createElement("div");
        imgContainer.className = "compare-image-container";
        
        // Swap images if requested
        const [displayImg1, displayImg2] = this.options.swapImages 
            ? [this.img2, this.img1] 
            : [this.img1, this.img2];
        
        const [displayCaption1, displayCaption2] = this.options.swapImages 
            ? [this.caption2, this.caption1] 
            : [this.caption1, this.caption2];
        
        // Create and append the first image
        const firstImgElement = document.createElement("img");
        firstImgElement.src = displayImg1;
        firstImgElement.className = "compare-image compare-image-1";
        imgContainer.appendChild(firstImgElement);

        // Create and append the second image
        const secondImgElement = document.createElement("img");
        secondImgElement.src = displayImg2;
        secondImgElement.className = "compare-image compare-image-2";
        imgContainer.appendChild(secondImgElement);

        // Create the slider handle
        const sliderHandle = document.createElement("div");
        sliderHandle.className = "compare-slider-handle";
        
        // Create the slider line
        const sliderLine = document.createElement("div");
        sliderLine.className = "compare-slider-line";
        
        // Append line to the handle
        sliderHandle.appendChild(sliderLine);
        
        // Add handle to the container
        imgContainer.appendChild(sliderHandle);

        // Add labels if enabled
        if (this.options.showLabels) {
            const label1 = document.createElement("div");
            label1.className = "compare-label compare-label-1";
            label1.textContent = this.options.label1 ?? null;
            
            const label2 = document.createElement("div");
            label2.className = "compare-label compare-label-2";
            label2.textContent = this.options.label2 ?? null;
            
            imgContainer.appendChild(label1);
            imgContainer.appendChild(label2);
        }
        
        // Add captions if provided
        if (displayCaption1 || displayCaption2) {
            const captionContainer = document.createElement("div");
            captionContainer.className = "compare-caption-container";
            
            if (displayCaption1) {
                const caption1Element = document.createElement("div");
                caption1Element.className = "compare-caption compare-caption-1";
                caption1Element.textContent = displayCaption1;
                captionContainer.appendChild(caption1Element);
            }
            
            if (displayCaption2) {
                const caption2Element = document.createElement("div");
                caption2Element.className = "compare-caption compare-caption-2";
                caption2Element.textContent = displayCaption2;
                captionContainer.appendChild(caption2Element);
            }
            
            compareContainer.appendChild(captionContainer);
        }

        // Add image container to main container
        compareContainer.appendChild(imgContainer);
        
        // Store references for later use
        this.element = compareContainer;
        this.slider = sliderHandle;
        
        // Add event listeners
        this.addEventListeners();
        
        // CRITICAL: Directly append to the container - this ensures it's in the DOM
        this.container.appendChild(compareContainer);
        
        return compareContainer;
    }

    private updateSliderPosition(position: number): void {
        if (!this.element) return;
        
        // Ensure position is within bounds
        position = Math.max(0, Math.min(100, position));
        
        // Set the position as a CSS variable
        this.element.style.setProperty('--compare-position', `${position}%`);
    }

    private addEventListeners(): void {
        if (!this.element || !this.slider) return;
        
        let isDragging = false;
        
        // Handle mouse/touch events
        const handleDragStart = (e: MouseEvent | TouchEvent) => {
            isDragging = true;
            
            // Prevent image dragging
            e.preventDefault();
        };
        
        const handleDragMove = (e: MouseEvent | TouchEvent) => {
            if (!isDragging || !this.element) return;
            
            const imgContainer = this.element.querySelector(".compare-image-container") as HTMLElement;
            const rect = imgContainer.getBoundingClientRect();
            
            let position: number;
            
            if (this.options.orientation === "vertical") {
                const pageX = "touches" in e ? e.touches[0].pageX : e.pageX;
                position = ((pageX - rect.left) / rect.width) * 100;
            } else {
                const pageY = "touches" in e ? e.touches[0].pageY : e.pageY;
                position = ((pageY - rect.top) / rect.height) * 100;
            }
            
            this.updateSliderPosition(position);
        };
        
        const handleDragEnd = () => {
            isDragging = false;
        };
        
        // Add mouse events
        this.slider.addEventListener("mousedown", handleDragStart);
        document.addEventListener("mousemove", handleDragMove);
        document.addEventListener("mouseup", handleDragEnd);
        
        // Add touch events for mobile
        this.slider.addEventListener("touchstart", handleDragStart);
        document.addEventListener("touchmove", handleDragMove);
        document.addEventListener("touchend", handleDragEnd);
        
        // Cleanup function
        const cleanup = () => {
            document.removeEventListener("mousemove", handleDragMove);
            document.removeEventListener("mouseup", handleDragEnd);
            document.removeEventListener("touchmove", handleDragMove);
            document.removeEventListener("touchend", handleDragEnd);
        };
        
        // Store cleanup function for later
        (this.element as any)._compareCleanup = cleanup;
    }

    public destroy(): void {
        if (this.element) {
            // Call cleanup function if it exists
            if ((this.element as any)._compareCleanup) {
                (this.element as any)._compareCleanup();
            }
            
            // Remove the element from the DOM
            if (this.element.parentNode) {
                this.element.parentNode.removeChild(this.element);
            }
            
            this.element = null;
            this.slider = null;
        }
    }
}