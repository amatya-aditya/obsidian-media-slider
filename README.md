# Media Slider 


![release](https://img.shields.io/github/v/release/amatya-aditya/obsidian-media-slider?style=flat-square&color=573E7A&label=release)
![downloads](https://img.shields.io/github/downloads/amatya-aditya/obsidian-media-slider/total?style=flat-square&color=94k&label=downloads)
![license](https://img.shields.io/github/license/amatya-aditya/obsidian-media-slider?style=flat-square&color=AGPL-3.0-orange&label=license)


<a href="https://www.buymeacoffee.com/amatya_aditya"><img src="https://img.buymeacoffee.com/button-api/?text=Buy me a book&emoji=📓&slug=amatya_aditya&button_colour=5F7FFF&font_colour=ffffff&font_family=Cookie&outline_colour=000000&coffee_colour=FFDD00" /></a>

The Media Slider Plugin is a powerful tool for displaying images, videos, audio files, PDFs, and even Markdown content in a beautiful, interactive slider within Obsidian. In addition to the basic slideshow features, this plugin supports interactive notes, drawing annotations, audio/video visualizers, and a variety of smooth transition effects. This guide will walk you through the features and explain how to set everything up.

![image](https://github.com/user-attachments/assets/7b19f451-8deb-4961-990e-0643d26af010)



  <!-- Video Thumbnail -->
  <a href="https://www.youtube.com/watch?v=Ie73HjSW85Y" target="_blank">
    <img src="https://img.youtube.com/vi/Ie73HjSW85Y/0.jpg" style="width: 65%; ">
  </a>

  <!-- Play Button -->
  <a href="https://www.youtube.com/watch?v=Ie73HjSW85Y" target="_blank">
    <img src="https://upload.wikimedia.org/wikipedia/commons/b/b8/YouTube_play_button_icon_%282013%E2%80%932017%29.svg" 
         style="width: 50px; height: auto; ">
  </a>


## 1. Overview

The Media Slider Plugin allows you to showcase your media files in a dynamic slider. With a few lines of configuration in your Obsidian notes, you can display media with smooth transitions, add interactive notes, draw on images, and even enable audio/video visualizations. It’s designed to be highly customizable and user-friendly.


## 2. Installation

The plugin is available through Obsidian as a community plugin.

### Manual installation

  1. Download the latest release files (manifest.json, styles.css, main.js) from the Releases page.
  2. Create a folder named "media-slider" in the Obsidian plugins folder (.obsidian/plugins).
  3. Copy the files from step 1 into the new folder.
  4.  Enable the plugin in the Obsidian settings under the "Community plugins" section. You might have to restart Obsidian to see the plugin.


## 3. Creating a Media Slider

To create a slider in your note, wrap your media list in a code block tagged with media-slider. For example:
```
```media-slider
---
sliderId: my-slider
carouselShowThumbnails: true
thumbnailPosition: bottom
captionMode: overlay
autoplay: false
slideshowSpeed: 5
width: 100%
height: 300px
transitionEffect: fade
transitionDuration: 500
enhancedView: true
interactiveNotes: true
---

![[image1.png]]
![[video1.mp4]]
![[audio1.mp3]]
![](https://dfstudio-d420.kxcdn.com/wordpress/wp-content/uploads/2019/06/digital_camera_photo-1080x675.jpg)
![[some.pdf]]
![[gif1.gif]]

```

- **YAML Metadata:**  
  The section between the `---` lines is used to configure slider behavior (see next section).

- **Media Files:**  
  Each media file is listed on a new line using Obsidian’s link syntax. You can include images, videos, audio files, PDFs, or Markdown files.

---

## 4. YAML Metadata Options

Inside the YAML block at the top of your media-slider code block, you can customize various options:

- **sliderId:**  
  A unique identifier for the slider. If not set, a default ID is generated.
  
- **carouselShowThumbnails:**  
  `true` or `false` to show thumbnails below (or beside) the slider.
  
- **thumbnailPosition:**  
  Choose from `top`, `bottom`, `left`, or `right`.
  
- **captionMode:**  
  Set to `overlay` (caption appears on top of the media) or `below` (caption appears in a separate container).
  
- **autoplay:**  
  Enable automatic playback of the slideshow (`true` or `false`).
  
- **slideshowSpeed:**  
  Time (in seconds) between slides during autoplay.
  
- **width & height:**  
  Specify the dimensions of your slider (e.g., `"100%"` or `"300px"`).
  
- **transitionEffect:**  
  Select the transition effect (see [Transition Effects](#transition-effects) below).
  
- **transitionDuration:**  
  Duration (in milliseconds) of the transition effect.
  
- **enhancedView:**  
  If `true`, displays additional buttons for fullscreen mode and a copy button that copies the Markdown image link.
  
- **interactiveNotes:**  
  Enables an interactive notes panel for each media slide.

---

## 5. Supported Media Formats

The plugin supports a variety of file types:

- **Images:** PNG, JPG, JPEG, GIF  
- **Videos:** MP4, WebM  
- **Audio:** MP3, OGG, WAV  
- **PDFs:** Displayed in an iframe  
- **Markdown Files:** Rendered within the slider

If a file type isn’t directly supported, a simple link will be provided.

---

## 6. Transition Effects

You can choose from multiple transition effects to create smooth and appealing animations between slides. Set the `transitionEffect` option in your YAML block to one of the following:

- **fade:**   
  Fades out the current slide before fading in the next.
  
- **slide:**  
  Slides the current image out and the next one in from the side.
  
- **zoom:**  
  Zooms out the current slide and then zooms in the next.
  
- **slide-up:**  
  Moves the slide upward out of view, with the next slide coming up from below.
  
- **slide-down:**  
  Moves the slide downward out of view, with the next slide coming from above.
  
- **flip:**  
  Flips the slide horizontally during transition.
  
- **flip-vertical:**  
  Flips the slide vertically.
  
- **rotate:**  
  Rotates the slide slightly before showing the next slide.
  
- **blur:**  
  Blurs the current slide during transition.
  
- **squeeze:**  
  Applies a horizontal squeeze (scaleX) effect.

*Tip:* Adjust the `transitionDuration` to control how fast or slow these effects occur.

---

## 7. Enhanced View

When `enhancedView` is enabled, you get two extra features:

- **Fullscreen Button:**  
  Click the ⛶ button to toggle fullscreen mode for a more immersive viewing experience.
  
- **Copy Button:**  
  Click the 📋 button to copy the Markdown image link (formatted like `![[image-link]]`) to your clipboard. This is useful for easily referencing media in your notes.

---

## 8. Interactive Notes

If you enable `interactiveNotes` in your YAML metadata, a notes button (📝) will appear on the slider. Clicking it will display a text area where you can add or edit notes specific to the current slide. These notes are saved persistently and will appear again when you return to that slide.

---

## 9. Drawing Annotations

If you enable drawing annotations in the global plugin settings, a drawing button (✏️) will appear. Here’s how it works:

- **Start Drawing:**  
  Click the ✏️ button to enter drawing mode. You can annotate directly on the current image.
  
- **Save Drawing:**  
  Once done, click the button (which will change to a 💾 icon) to save your annotation.
  
- **Clear Drawing:**  
  A trash icon (🗑️) will appear if an annotation exists. Click it to remove the annotation.

---

## 10. Visualizer for Audio/Video

For media files that support audio or video, you can enable a wave-like visualizer:

- **Enable Visualizer:**  
  In the global settings, toggle **Enable Visualizer** to `true`.
  
- **Customization:**  
  You can set the `visualizerColor` (any valid CSS color) and `visualizerHeight` (e.g., `"50px"`) from the plugin settings.

This feature creates a dynamic visualization (like an audio waveform) over the media during playback.

---

## 11. Thumbnails and Navigation

- **Thumbnails:**  
  When enabled via `carouselShowThumbnails`, small preview images (or placeholders for non-image media) are displayed either below, above, or beside the slider based on the `thumbnailPosition` option. Click a thumbnail to jump to that slide.

- **Navigation Buttons:**  
  Large arrows (⮜ and ⮞) are displayed on either side of the slider to move to the previous or next slide.
  
- **Keyboard and Touch Controls:**  
  You can navigate slides using the left/right arrow keys, mouse wheel, or touch gestures on mobile devices.

---

## 12. Automatic Slideshow

If you set the `slideshowSpeed` option to a value greater than 0, the slider will automatically advance to the next slide after the specified number of seconds. This is ideal for presentations or unattended displays.

---

## 13. Troubleshooting & Tips

- **Media Not Showing:**  
  Ensure that the media file paths are correct and that the files exist in your vault. Use Obsidian’s internal link syntax (e.g., `![[image.png]]`) for best results.
  
- **Transition Issues:**  
  If a transition doesn’t appear as expected, try adjusting the `transitionDuration` or choose a different `transitionEffect`.
  
The Media Slider Plugin is designed to be both flexible and easy to use. By adjusting the YAML metadata in your code blocks and tweaking global settings, you can create a rich, interactive media display experience in Obsidian. Enjoy showcasing your media with smooth transitions, interactive notes, drawing annotations, and more!

Happy sliding!

---

# Roadmap

- [ ] Paste the image directly in container without opening the codeblock
- [ ] Render YouTube Videos as media-slider element
- [ ] Provide Settings for customizing compression ratio
- [ ] Zoom and Pan


# Support
If you encounter any issues or have suggestions, Create an issue on GitHub
    
## Support the development:
![BuyMeCoffee](buymeacoffee.com/amatya_aditya)
<a href="https://www.buymeacoffee.com/amatya_aditya"><img src="https://img.buymeacoffee.com/button-api/?text=Buy me a book&emoji=📓&slug=amatya_aditya&button_colour=5F7FFF&font_colour=ffffff&font_family=Cookie&outline_colour=000000&coffee_colour=FFDD00" /></a>
