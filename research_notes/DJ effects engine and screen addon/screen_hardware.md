# Display and compute hardware for a DIY "CDJ-3000 style" companion screen (DDJ-FLX2 / DDJ-FLX4)

Research date: 2026-11-20. Method caveat: in this environment direct page fetches were blocked for every vendor/news host tried (pioneerdj.com, waveshare.com, tomshardware.com, djtechtools.com, espressif github.io). All findings below therefore come from web-search result extracts, not full-page reads. URLs are the pages the search engine attributed each fact to. Prices are snapshots (date given where the source stated one) and are volatile in 2026 because of the DRAM shortage and US tariffs; re-check before ordering. All "computed" dimensions are my own arithmetic from diagonal and aspect ratio, assuming square pixels.

## 1. Reference target: what screens do the CDJ-3000 and comparable pro units use?

### Takeaway
The pro reference is a 9 to 10.1 inch, roughly 1280x720 to 1280x800 touch LCD: CDJ-3000 = 9 inch "HD" (reported 720p, not multi-touch), CDJ-3000X / XDJ-RX3 = 10.1 inch WXGA 1280x800. A cheap 7 to 10.1 inch 1024x600 or 1280x800 HDMI panel, or a 1920x440/480 bar, is already in the same resolution class.

### Cited Findings
- CDJ-3000: 9-inch full-colour "HD" LCD touch screen per Pioneer DJ spec pages — [Pioneer DJ CDJ-3000 specs](https://www.pioneerdj.com/en/product/player/cdj-3000/black/specs/)
- CDJ-3000 screen reported as 720p and not multi-touch — [DJ Mag](https://djmag.com/news/pioneer-dj-introduce-their-next-gen-player-cdj-3000). Pioneer itself only says "HD"; no Pioneer page with a pixel count was found.
- CDJ-3000 max brightness "improved by more than 150%" versus CDJ-2000NXS2; 9 inch, higher resolution than NXS2 — [Pioneer DJ CDJ-3000 overview](https://www.pioneerdj.com/en/product/player/cdj-3000/black/overview/); [Mixmag](https://mixmag.net/feature/pioneer-dj-cdj-3000)
- CDJ-3000X (released; AlphaTheta's "next-generation professional DJ player"): 10.1 inch, WXGA 1280x800, capacitive touch; comparison table lists CDJ-3000X 10.1 inch, CDJ-3000 9 inch, CDJ-2000NXS2 7 inch — [Pioneer DJ player comparison table](https://www.pioneerdj.com/en/landing/comparison/dj-player/); [AlphaTheta CDJ-3000X](https://alphatheta.com/en/product/player/cdj-3000x/); [B&H listing](https://www.bhphotovideo.com/c/product/1915621-REG/alphatheta_cdj_3000x_high_resolution_professional_dj.html)
- A reviewer states the CDJ-3000X screen is the same one found on the XDJ-AZ and that it sits flush like the XDJ-AZ and Opus-Quad screens (reviewer observation, not a spec sheet) — [Crossfader CDJ-3000X review](https://wearecrossfader.co.uk/blog/cdj-3000x-review/); [Digital DJ Tips](https://www.digitaldjtips.com/alphatheta-launches-cdj-3000x/)
- XDJ-AZ: 10.1-inch capacitive touchscreen (no resolution found) — [AlphaTheta XDJ-AZ](https://alphatheta.com/en/product/all-in-one-dj-systems/xdj-az/)
- XDJ-RX3: 10.1-inch touch screen with "higher resolution and frame rate" than its predecessor; comparison table lists WXGA (1280:800) — [Pioneer DJ XDJ-RX3 news](https://www.pioneerdj.com/en-us/news/2021/xdj-rx3-new-2-channel-performance-all-in-one-dj-system/); [Pioneer DJ all-in-one comparison](https://www.pioneerdj.com/landing/comparison/dj-all-in-one)
- Opus-Quad: 10.1-inch multi-touch touchscreen — [Serato](https://serato.com/dj/hardware/pioneer-dj-opus-quad); [Sweetwater](https://www.sweetwater.com/store/detail/OpusQuad). WXGA 1280x800 appears to be listed in Pioneer's flattened comparison table but the search tool inferred it from column order — [Pioneer DJ all-in-one comparison](https://www.pioneerdj.com/landing/comparison/dj-all-in-one)
- Denon DJ Prime 4+: one 10.1 inch / 256.5 mm colour LCD touchscreen, "HD", tiltable — [Full Compass](https://fullcompass.com/prod/622660-denon-dj-prime-4-4-deck-stand-alone-dj-controller-with-10-1); [Denon DJ](https://www.denondj.com/prime-4-prime4xus); [Adorama](https://www.adorama.com/ddprime4xus.html)
- Denon DJ SC6000 Prime: 10.1 inch (257 mm) HD touchscreen — [Denon SC6000 summary PDF via Thomann](https://im.static-thomann.de/pics/atg/atgdata/document/misc/482556_dj_sc6000_summary_en.pdf)

### Inferences
- Computed active areas: 9 inch 16:9 is about 199 x 112 mm; 10.1 inch 16:10 is about 217 x 136 mm. A commodity 10.1 inch 1280x800 HDMI touch panel is a pixel-for-pixel match for the CDJ-3000X / XDJ-RX3 class; a 7 inch 1024x600 has about 64% of the CDJ-3000's (assumed 1280x720) pixel count.
- Because the CDJ-3000's touch is reported as single-touch, a cheap panel with basic single-point USB touch is not a functional downgrade from the reference.

### Gaps
- What the CDJ-3000 screen shows (enlarged/zoomable waveform, overview waveform, 3-band colour, stacked waveforms, Touch Preview, Touch Cue, Beat Jump, key shift, browse lists) is known to me only from background knowledge; no page stating it was retrieved in this session, so treat that list as unsourced.
- No source found for any of these units' panel refresh rate, exact panel part number, or nits. Denon pixel resolutions not found (only "HD").
- pioneerdj.com and rekordbox.com were unreachable for direct verification.

## 2. Architecture A, "dumb display": small HDMI / USB-C monitor driven by the laptop

### Takeaway
This is the cheapest and lowest-risk path: a 7 inch 1024x600 HDMI touch panel is about $42 to $57, bar displays (7.9 inch 400x1280, 8.8 inch 1920x480, 11.26 inch 1920x440) run about $65 to $118, and 12.3 inch 1920x720 about $110 to $150+. The 11.26 to 12.3 inch bars (about 280 to 295 mm wide) are the best fit across a 383 mm FLX2 or 482 mm FLX4; nearly all need two cables (HDMI + USB for power/touch).

### Cited Findings
Controller widths (for fit):
- DDJ-FLX4: 482 x 272.8 x 59.2 mm (W x D x H), 2.1 kg — [Pioneer DJ FLX4 specifications](https://www.pioneerdj.com/en-us/product/controller/ddj-flx4/black/specifications/); [FLX4 spec sheet](https://cdn.teufelaudio.com/products/PIONEER/DDJ-FLX4/DDJ-FLX4-spec-sheet-HR)
- DDJ-FLX2: 383.2 x 208 x 48.2 mm (W x D x H), 1.2 kg — [FLX2 spec sheet](https://cdn.teufelaudio.com/products/AlphaTheta/DDJ-FLX2/DDJ-FLX2-spec-sheet-HR); [Currys](https://www.currys.co.uk/products/pioneer-dj-ddjflx2-smart-dj-controller-black-10285273.html)

7 inch 1024x600 HDMI touch (16:9-ish):
- Waveshare 7inch HDMI LCD (C), 1024x600 IPS capacitive, SKU 11199: about $42.29 to $43.99 on Waveshare's store; (H) version SKU 14628 with OSD brightness menu: $46.29 to $47.99; (H) with case SKU 13857: $52.29 to $53.99 (undated listing) — [Waveshare LCD listing](https://www.waveshare.com/product/displays/lcd-oled/lcd-oled-1.htm?dir=asc&p=2)
- Same (H) panel at a US retailer: $56.56 including US tariffs, "re-stocking soon" — [RobotShop](https://www.robotshop.com/products/7-in-hdmi-lcd-1024x600-ips-capacitive-touch-screen)
- Generic/LESOWN/Treedix 7 inch 1024x600 HDMI touch monitors on Walmart: about $62 to $98 ($64.99 Treedix; $73.62 to $88.86 LESOWN) — [Walmart 7 inch touch listings](https://www.walmart.com/c/kp/7-touch-screen-raspberry-pi); [Walmart generic listing](https://www.walmart.com/ip/7-Inch-Raspberry-Pi-Monitor-Capacitive-Touchscreen-1024x600-IPS-Display-HDMI-USB-Powered-Portable-Secondary-Screen-Windows-Linux-Android-Raspberry-Pi/17487509957)
- The (C) panel exposes solder pads for PWM backlight dimming — [The Pi Hut 7 inch IPS capacitive](https://thepihut.com/collections/hdmi-displays-for-raspberry-pi/products/7-ips-capacitive-touchscreen-lcd-low-power-1024x600)

10.1 inch 1280x800 HDMI touch (CDJ-3000X class):
- Waveshare 10.1inch HDMI LCD (B) with case, 1280x800 IPS capacitive: $110.99 on Waveshare's store (undated); $227.65 at RobotShop US including tariffs; GBP 106.60 at The Pi Hut. Kit includes case, stand, HDMI cable and 5 V 2.5 A adapter — [Waveshare](https://www.waveshare.com/10.1inch-hdmi-lcd-b-with-case.htm); [RobotShop](https://robotshop.com/products/101-1280x800-lcd-screen-hdmi-case); [The Pi Hut](https://thepihut.com/products/hdmi-10-1-1280x800-touch-screen-and-case)

Bar / stretched displays:
- Waveshare 7.9inch HDMI LCD, 400x1280 IPS capacitive touch, toughened glass: $91.58 at RobotShop US (includes tariffs); GBP 75.90 at The Pi Hut; Waveshare's related 7.9 inch side monitor $78.99 to $89.99 — [RobotShop](https://www.robotshop.com/products/waveshare-79-capacitive-touch-screen-lcd-4001280-hdmi-ips-toughened-glass-cover); [The Pi Hut](https://thepihut.com/products/7-9-ips-capacitive-touchscreen-400x1280); [Waveshare 7.9 side monitor](https://www.waveshare.com/7.9inch-side-monitor.htm?sku=25487)
- 7.84 inch 1280x400 IPS with HDMI driver board (ER-TFT0784-2-5717, touch not confirmed): $54.82 — [BuyDisplay](https://buydisplay.com/7-84-inch-1280x400-ips-tft-lcd-display-w-hdmi-board-for-raspberry-pi)
- 8.8 inch 1920x480 HDMI capacitive-touch bar monitors: $117.97 (Walmart) and $78.99 (a Newegg listing; exact URL not confirmed); an Elecrow 1920x480 IPS panel listed at $64.60 (check interface) — [Walmart](https://www.walmart.com/ip/17362917650); [Newegg](https://www.newegg.com/p/3C6-03VM-01A31); [Hackster/Elecrow](https://hackster.io/products/buy/104865)
- An 8.8 inch 1920x480 model with HDMI + USB-C, metal shell, 10-point multi-touch, 400 cd/m2 — [Best Buy Canada listing](https://www.bestbuy.ca/en-ca/product/8-8-inch-mini-touchscreen-stretched-bar-monitor-1920-480-metal-shell-ips-portable-touch-display-hdmi-usb-c-small-screen-for-raspberry-pi-laptop-cpu-ram-monitoring-pc-case/19591129)
- Waveshare 8.8inch Side Monitor (480x1920 HDMI): no touch; USB-C is power only; about 500 mA at brightest; marked discontinued at The Pi Hut (GBP 93.20) — [Waveshare wiki](https://www.waveshare.com/wiki/8.8inch_Side_Monitor); [The Pi Hut](https://thepihut.com/products/8-8-ips-hdmi-side-monitor-480x1920)
- Warning: some cheap 8.8 inch 480x1920 panels are DSI (Raspberry Pi only), not HDMI — [DFRobot 8.8 inch DSI](https://www.dfrobot.com/product-2828.html)
- 11.26 inch 1920x440 HDMI capacitive touch with speakers: 52Pi $99.00; GeeekPi on Amazon $89.99 (price last updated 2026-04-23) — [52Pi](https://52pi.com/products/52pi-11-26-inch-capacitive-touch-screen-1920x440-hdmi-display-screen-with-speakers-for-raspberry-pi-5-4b-3b-3b); [GeeekPi B0F6NPCX1V](https://specpicks.com/product/B0F6NPCX1V)
- Waveshare 11.9inch HDMI LCD, 320x1480, 5-point capacitive: GBP 98.90 (The Pi Hut); Waveshare reference retail price $111.99 (via Switch Science) — [The Pi Hut](https://thepihut.com/collections/raspberry-pi-store/products/11-9-ips-capacitive-touchscreen-320x1480); [Switch Science](https://www.switch-science.com/collections/waveshare/products/7891)
- Waveshare 12.3inch HDMI LCD, 1920x720 IPS, 10-point capacitive, toughened glass: GBP 105.60 (The Pi Hut) — [The Pi Hut](https://thepihut.com/products/12-3-ips-capacitive-10-point-touch-display-1920x720); [Waveshare](https://www.waveshare.com/12.3inch-hdmi-lcd.htm)
- Bare 12.3 inch 1920x720 automotive panels (HSD123KPW1) with driver board: EUR 109.99 (Type-C/HDMI/TF board), US $129 (DVI/VGA board), US $149.99 (Type-C board) on eBay; panel 850 cd/m2 native, 400 cd/m2 with one vendor's HDMI board; sibling panel HSD123KPW2 active area 292.032 x 109.512 mm — [eBay kit](https://www.ebay.de/itm/396776395375); [eBay DVI/VGA](https://www.ebay.de/itm/184609800378); [Suntex](https://pr.mono.ipros.com/en/suntex/product/detail/2000512341); [Newegg HSD123KPW2](https://www.newegg.com/p/3C6-020A-01S46)

Touch over USB:
- Waveshare HDMI capacitive panels: Windows 11/10/8.1/8/7 10-point touch, driver-free; touch-point count "depends on the operating system"; some models single-point only on some OSes — [Waveshare 12.3inch HDMI LCD](https://www.waveshare.com/12.3inch-hdmi-lcd.htm); [Waveshare 10.1inch HDMI LCD (E)](https://www.waveshare.com/10.1inch-HDMI-LCD-E.htm)

Ordinary portable monitors (single USB-C cable, no touch):
- KYY K3 15.6 inch 1080p IPS, two USB-C ports carrying video + power, plus mini-HDMI: $60 on sale (list $70) at Amazon; another 15.6 inch (MNN) dipped just under $50 — [TechRadar](https://techradar.com/pro/the-kyy-k3-portable-monitor-is-cheap-but-remarkably-cheerful-now-our-favorite-budget-display-drops-to-under-usd60); [Android Authority deals](https://www.androidauthority.com/deals-post-3655564/)
- Single-cable use requires the laptop's USB-C port to support DisplayPort Alt Mode / Thunderbolt; "USB-C doesn't automatically mean the port supports video" — [BGR portable monitors 2026](https://bgr.com/2119644/best-budget-expensive-portable-monitors-2026)

USB-driven (non-HDMI) sim-racing screens:
- VoCore/VoDisplay: 4 inch 800x480, video over USB 2.0, touch via USB, 24 fps (24-bit) / 30 fps (16-bit); $35.95 at Ameridroid (out of stock); 5 inch MPRO reports 60 fps partial draw / 33 fps full draw; draws about 300 mA, needs a good cable — [Ameridroid VoDisplay](https://ameridroid.com/products/vodisplay-touchscreen); [vonger.cn dashboard solution](https://vonger.cn/?p=15359); [VoCore Screen](https://vocore.io/screen.html)
- SimHub added 5 inch VoCore support in 7.4.0; users report dead/blank units and image-offset problems — [SimHub forum vocore 5](https://www.simhubdash.com/community-2/simhub-support/vocore-5); [SimHub forum LCD not showing](https://www.simhubdash.com/community-2/simhub-support/vocore-lcd-not-showing)

### Inferences
- Computed active widths vs controller width (FLX2 383 mm / FLX4 482 mm): 7.84 to 7.9 inch bar about 190 x 60 mm (50% / 39%); 8.8 inch 1920x480 about 217 x 54 mm (57% / 45%); 11.26 inch 1920x440 about 279 x 64 mm (73% / 58%); 11.9 inch 320x1480 about 295 x 64 mm (77% / 61%); 12.3 inch 1920x720 292 x 110 mm (76% / 61%); 10.1 inch 16:10 about 217 x 136 mm; 7 inch about 153 x 90 mm; 15.6 inch 16:9 about 345 x 194 mm (90% / 72%).
- Aspect guidance: 4:1 to 4.4:1 bars (8.8, 11.26 inch) suit two stacked horizontal scrolling waveforms plus a thin info strip but leave little height (54 to 64 mm) for a browse list; 8:3 (12.3 inch, 110 mm tall) is the only bar that comfortably holds two waveforms plus track info plus a browser, and is closest to "two CDJ screens side by side". A 7 or 10.1 inch 16:9/16:10 panel is better if the unit is per-deck or sits centred above the mixer section.
- Many bar panels are natively portrait (400x1280, 480x1920, 320x1480) and must be rotated in the OS display settings; listings with landscape-native 1920x480 / 1920x440 avoid that.
- With a dumb display the laptop GPU renders at the panel's native 60 Hz with no boot time, no sync protocol and no firmware; this is the best performance per dollar. Cost is two cables (HDMI + USB) unless hidden behind a USB-C hub (see section 7).
- For dark booths, the issue is being too bright rather than too dim; prefer panels with a real brightness control (OSD button on Waveshare (H), PWM pads on (C), or DDC), and IPS for off-axis viewing since the unit sits flat/tilted below eye level.

### Gaps
- No Amazon US prices for the generic 7 inch HDMI touch panels (Hosyond, ROADOM, Elecrow) could be retrieved; no AliExpress prices retrieved.
- No measured power draw (mA) for the 7 inch, 7.9 inch, 11.26 inch or 12.3 inch panels; only the 8.8 inch (about 500 mA) and VoCore (about 300 mA) figures were found. No nit ratings for Waveshare 7/7.9 inch.
- macOS touch behaviour for these USB HID touch panels was not found (Waveshare documents Windows/Linux only). Assume touch may be single-point or mis-mapped to the primary display on macOS until tested.
- Pimoroni HyperPixel and 14 inch 1920x550 bars were not researched (HyperPixel is a Pi-only DPI display, so irrelevant to Architecture A).
- Driving VoCore-type USB screens outside SimHub needs custom driver work; no source on cross-platform libraries was retrieved.

## 3. Architecture B, "smart display": single-board computer rendering locally

### Takeaway
SBC prices have roughly doubled in 2026 (Pi 5 2GB $77.50, 4GB $85 to $110 depending on source, Pi 4 2GB $67.50), and the Pi Zero 2 W ($15 list) is reported sold out, so a smart display now adds about $60 to $130 plus PSU/SD over a dumb panel. A Pi 5 is the safe choice for 60 fps; boot is about 20 s stock (app start 2 to 5 s), and official USB gadget mode makes "one USB-C cable to the laptop = power + Ethernet" straightforward.

### Cited Findings
Prices (USD list):
- Raspberry Pi 5: 1GB $45 (unchanged through 2026); 2GB $77.50 from October 2026 (was $65 in April) — [Phoronix, Oct 2026](https://www.phoronix.com/news/Raspberry-Pi-5-2GB-Price-77.50); [BetaNews](https://betanews.com/article/raspberry-pi-launches-1gb-raspberry-pi-5-at-45-raises-the-price-of-other-models)
- Pi 5 4GB / 8GB: Phoronix (1 Oct 2026) says $110 / $180 — [Phoronix](https://www.phoronix.com/news/Raspberry-Pi-5-2GB-Price-77.50); contradicted by Tom's Hardware table listing $85 / $130 as of October 2026 — [Tom's Hardware](https://www.tomshardware.com/raspberry-pi/component-shortages-drive-raspberry-pi-prices-up-by-up-to-23-percent-escalating-lpddr4-lpddr5-costs-trigger-the-third-price-hike-of-the-year); Liliputing reported $110 / $175 after 1 April 2026 — [Liliputing](https://liliputing.com/?p=198888)
- A further November 2026 increase hit higher-RAM Pi 5 models (8GB at $175 reported; figures not internally consistent) — [TechRadar](https://www.techradar.com/pro/raspberry-pi-5-price-hike-means-the-16gb-model-now-costs-three-times-what-it-did-at-launch-and-of-course-the-global-ram-shortage-is-to-blame); [OMG! Ubuntu, Nov 2026](https://omgubuntu.co.uk/2026/11/raspberry-pi-5-price-goes-up-and-up)
- Pi 4: 1GB $35; 2GB rose from $55 to $67.50 in October 2026 — [OMG! Ubuntu, Oct 2026](https://www.omgubuntu.co.uk/2026/10/raspberry-pi-2gb-costs-how-much-now); [BetaNews](https://betanews.com/article/raspberry-pi-launches-1gb-raspberry-pi-5-at-45-raises-the-price-of-other-models)
- Pi Zero 2 W: $15 list, no increase expected (LPDDR2 inventory) — [Raspberry Pi news](https://raspberrypi.com/news/more-memory-driven-price-rises); [Raspberry Pi product page](https://raspberrypi.com//products/raspberry-pi-zero-2-w/); SparkFun $17.25 — [SparkFun](https://www.sparkfun.com/raspberry-pi-zero-2-w.html); but reported "sold out almost everywhere for months" as of September 2026 — [raspberry.tips](https://raspberry.tips/en/raspberrypi-infos/raspberry-pi-zero-2-w-alternative-sold-out)
- Alternatives: Orange Pi Zero 3W (Allwinner A733) $25 1GB / $35 2GB / $50 4GB — [CNX Software, Apr 2026](https://www.cnx-software.com/2026/04/15/orange-pi-zero-3w-an-allwinner-a733-sbc-in-raspberry-pi-zero-form-factor/); Orange Pi Zero 2W from EUR 53 (1GB) on Amazon.de in Sept 2026; Radxa Zero 3W "import via Radxa only", no 2026 price found — [raspberry.tips](https://raspberry.tips/en/raspberrypi-infos/raspberry-pi-zero-2-w-alternative-sold-out); NanoPi Zero2 1GB still $18 — [CNX Software SBC prices 2024 vs 2026](https://www.cnx-software.com/2026/04/28/what-a-difference-two-years-make-comparing-sbc-prices-in-2024-and-2026/); Pine64 paused Linux devices over RAM/eMMC costs — [CNX Software, Aug 2026](https://www.cnx-software.com/2026/08/19/pine64-hits-pause-on-linux-devices-due-to-ram-and-emmc-shortage-high-prices)

Displays for an SBC:
- Raspberry Pi Touch Display 2 (DSI, 720x1280 portrait, 5-finger capacitive): 5 inch $40, 7 inch $60 list; works on all Pis except the Zero line; US resellers show about $88 — [Raspberry Pi](https://raspberrypi.com/products/touch-display-2); [Adafruit](https://www.adafruit.com/product/6079); [SparkFun](https://www.sparkfun.com/raspberry-pi-touch-display-2.html); [CanaKit](https://www.canakit.com/raspberry-pi-touch-display-2.html)
- Any HDMI panel from section 2 also works.

Performance and boot:
- Pi 5 desktop boot "just under 20 seconds" vs 35 s for Pi 4 (Bookworm) — [Core Electronics](https://core-electronics.com.au/guides/raspberry-pi-5-review-performance-and-benchmarks/)
- Chromium launch on Pi 5 about 5.1 to 5.5 s — [Tom's Hardware Pi 5 2GB benchmarks](https://tomshardware.com/raspberry-pi/raspberry-pi-5s-new-2gb-model-benchmarked-do-you-need-2-4-or-8gb-we-test-against-the-4-and-8gb-versions)
- Pi 5 about 3x Pi 4 frame rate in OpenArena at 720p — [Core Electronics Pi 5 vs Pi 4](https://core-electronics.com.au/guides/raspberry-pi-5-vs-raspberry-pi-4-model-b-comparison-and-benchmarking/)
- Raspberry Pi publishes a boot-time optimisation white paper (Pi 4/5 focus) — [Raspberry Pi white paper](https://pip-assets.raspberrypi.com/categories/685-app-notes-guides-whitepapers/documents/RP-010196-WP-1-Optimising%20boot%20time%20on%20Raspberry%20Pi%20single-board%20computers.pdf)
- flutter-pi runs Flutter with no X11/Wayland straight from the console on Pi 2/3/4 and Zero 2 W (not Pi 1/Zero); touch latency is a known weak point — [flutter-pi](https://github.com/ardera/flutter-pi)
- One blog claims Flutter kiosk cold start 2 to 4 s vs 15 to 25 s for Electron, 60 to 90 MB RAM, locked 60 fps (single author, unverified) — [developerspot blog](https://blogdeveloperspot.blogspot.com/2025/09/flutter-on-raspberry-pi-crafting-next.html)
- Mixxx 2.4 reworked scrolling waveforms (GLSL) to target 60 fps with lower CPU on all platforms — [Mixxx](https://mixxx.org/news/2024-02-23-improved-waveforms)
- A Pi 3 runs Mixxx with under 20 ms audio latency and no underruns when the controller has its own sound card — [Mixxx guest article](https://mixxx.org/news/2020-08-22-portable-mixxx-setup)

Data link to laptop:
- Official `rpi-usb-gadget` (Raspberry Pi OS Trixie; can be enabled in Imager 2.x) gives Ethernet-over-USB on Zero/Zero 2 W, 3A+, 4B, 5, CM4/CM5; Pi serves DHCP at 10.12.194.1/28; on Pi 4/5 it uses the USB-C power port, on Zero the inner micro-USB; that port then carries power and data and cannot host peripherals; direct connection to the PC (and a powered hub for Pi 5) is advised — [Raspberry Pi news](https://raspberrypi.com/news/usb-gadget-mode-in-raspberry-pi-os-ssh-over-usb); [rpi-usb-gadget](https://github.com/raspberrypi/rpi-usb-gadget); [Hackster](https://www.hackster.io/news/raspberry-pi-s-paul-oberosler-makes-usb-gadget-mode-as-easy-as-flicking-a-switch-492b04c2417a); [CNX Software](https://www.cnx-software.com/2026/01/22/raspberry-pi-os-adds-easier-usb-gadget-mode-support/)
- Raspberry Pi's cyberdeck guidance: a Pi 5 with a 3 W touchscreen at full brightness wants a supply of at least 28 W — [Raspberry Pi cyberdeck guide](https://www.raspberrypi.com/news/create-your-own-cyberdeck/)

### Inferences
- A Pi 5 gadget-powered from a laptop USB port is marginal: laptop ports source 4.5 to 15 W (section 7) while a Pi 5 plus screen is specified for much more. A Pi 4 / Zero 2 W class board is a better electrical fit for single-cable bus power; a Pi 5 should have its own USB-C PSU and use Wi-Fi or Ethernet for data.
- Software stack ranking for 60 fps scrolling waveforms on a Pi (my judgement from the above): native GL (SDL2/Qt Quick on eglfs/KMS, or flutter-pi) for Pi 4 and Zero 2 W; Chromium kiosk with canvas/WebGL is acceptable on Pi 5 and lets the same web app serve phones (Architecture D). LVGL on Linux framebuffer is possible but gains nothing over GL on a Pi.
- The smart display only earns its cost if it must keep working when the laptop screen is busy/closed or if a later goal is laptop-free playback (Mixxx standalone). For "render data supplied by a laptop" it is strictly more parts, boot time and a sync protocol than Architecture A.

### Gaps
- No benchmark found for Chromium-kiosk canvas/WebGL waveform fps on Pi 4/5/Zero 2 W, nor Mixxx waveform fps on Pi 5; one GitHub issue titled "Poor WebGL performance on RPi5" exists but content was unreadable.
- Pi 5 official PSU rating, idle/peak draw, and Pi 4 4GB / Compute Module current prices were not retrieved. Pi 5 4GB price is contested ($85 vs $110).
- No Qt/eglfs, cage or SDL boot-time measurements found.

## 4. Architecture C, microcontroller display (ESP32-S3 / ESP32-P4 / Teensy / RP2350)

### Takeaway
ESP32-S3 7 inch RGB boards are very cheap ($21 to $43) but benchmark at only about 12 to 25 fps with LVGL at 800x480 and have full-speed USB (about 0.8 to 1.2 MB/s), so they can show track info and a modest waveform but not a CDJ-smooth 60 fps scroll. The ESP32-P4 7 inch 1024x600 MIPI boards (about $46 to $54) are the credible MCU option: Espressif lists about 60 fps at 800x480 and the chip has high-speed USB.

### Cited Findings
- Espressif LVGL v9.4 benchmark (esp_lvgl_adapter): ESP32-S3 RGB 800x480 RGB565 about 25 FPS (about 2.3 MB PSRAM); ESP32-P4 about 60 FPS at the same resolution — [Espressif LCD application note](https://docs.espressif.com/projects/esp-techpedia/en/latest/esp-friends/advanced-development/lcd-application-note/overview.html)
- Espressif FAQ: ESP32-S3 RGB interface tops out around 59 Hz refresh at 30 MHz PCLK, with average LVGL frame rate 23 — [Espressif FAQ LCD](https://docs.espressif.com/projects/espressif-esp-faq/en/latest/software-framework/peripherals/lcd.html)
- esp_lvgl_port on the S3 EV board: LVGL 8 default average 18 FPS (weighted 24, 26 optimised); another run 12 to 13 FPS; about 9 FPS on LVGL 9.2 (different FPS algorithm) — [Waveshare-hosted performance PDF](https://files.waveshare.com/wiki/common/Performance.pdf); [esp-bsp performance.md](https://github.com/Lzw655/esp-bsp/blob/master/components/esp_lvgl_port/docs/performance.md)
- 4D Systems gen4-ESP32-50CT (LVGL 9.1): 22 FPS benchmark average, 14 FPS widget demo — [LVGL blog](https://lvgl.io/blog/showcase-4d-systems-esp32-50ct)
- Forum: 14 FPS (LVGL 8.3.11, direct mode, two full PSRAM buffers) — [LVGL forum](https://forum.lvgl.io/t/evaluating-performance-what-can-i-do-to-make-it-faster/23638)
- On ESP32-S3 the framebuffer lives in PSRAM and CPU and LCD DMA split PSRAM bandwidth roughly 50/50, so heavy drawing lowers frame rate — [esp32.com LCD buffering](https://esp32.com/viewtopic.php?p=144802)
- Sunton ESP32-8048S070: 7 inch 800x480 IPS, GT911 capacitive touch, ESP32-S3 16 MB flash / 8 MB PSRAM, USB-C; about $21 to $28 street — [atomic14](https://www.atomic14.com/esp32/boards/sunton-esp32-8048s070/)
- Elecrow CrowPanel 7.0 inch ESP32-S3 800x480 (DIS08070H): $29.17 on sale at Elecrow (list $42.90); $42.90 at RobotShop without case, $67.71 with case — [Elecrow](https://www.elecrow.com/esp32-display-7-inch-hmi-display-rgb-tft-lcd-touch-screen-support-lvgl.html); [RobotShop](https://robotshop.com/products/elecrow-crowpanel-70-hmi-esp32-display-800x480-rgb-tft-lcd-touchscreen-wo-case)
- Waveshare ESP32-S3-Touch-LCD-7: 8 MB PSRAM / 8 MB flash; sources conflict on resolution (Waveshare table 1024x600; resellers 800x480); $86.99 at Newegg; also stocked by Micro Center — [Waveshare](https://www.waveshare.com/product/esp32-related/esp32-s3-touch-lcd-7.htm); [Newegg](https://www.newegg.com/p/3C6-05AE-00196); [Micro Center](https://www.microcenter.com/quickView/705233/waveshare-esp32-s3-7inch-capacitive-touch-lcd-development-board)
- Elecrow CrowPanel Advanced 7 inch ESP32-P4: 1024x600 IPS multi-touch over MIPI-DSI, ESP32-C6 for Wi-Fi 6/BT 5.3; $45.90 without camera, $53.90 with (CNX); Elecrow listing "as low as $48.90"; reviewer found LVGL GUIs "smooth" (no fps figure) — [CNX Software launch](https://www.cnx-software.com/2025/10/26/crowpanel-advance-7-inch-esp32-p4-hmi-display-supports-zigbee-lora-and-2-4ghz-radio-modules/); [CNX Software review](https://www.cnx-software.com/2025/12/23/crowpanel-advanced-7inch-review-part-1-esp32-p4-hmi-ai-display-hands-on-with-lvgl-factory-firmware/); [Elecrow](https://www.elecrow.com/crowpanel-advanced-7inch-esp32-p4-hmi-ai-display-1024x600-ips-touch-screen-with-wifi-6-compatible-with-arduino-lvgl-micropython.html)
- USB data rates: ESP32-S2/S3 USB-OTG is full speed, 12 Mbps bus rate, lower effective — [Espressif USB-OTG](https://docs.espressif.com/projects/esp-iot-solution/en/latest/usb/usb_overview/usb_otg.html); TinyUSB on it is estimated at about 6.4 Mbps, about 9.6 Mbps with bulk transfers — [Espressif USB FAQ](https://docs.espressif.com/projects/esp-faq/en/latest/software-framework/peripherals/usb.html); ESP32-P4 has a high-speed 480 Mbps controller; a user reported erratic CDC throughput (up to about 8 Mbps) on the P4 full-speed port — [esp32.com](https://esp32.com/viewtopic.php?p=154896)
- Teensy 4.1: $35.50 with Ethernet / $33.60 without (PJRC), $31.50 at SparkFun — [PJRC](https://pjrc.com/store/teensy41_pins.html); [SparkFun](https://www.sparkfun.com/teensy-4-1.html)

### Inferences
- Pixel streaming is impossible on an S3: one 800x480 RGB565 frame is 768 kB, i.e. about 46 MB/s at 60 fps, versus about 0.8 to 1.2 MB/s over full-speed USB (about 1 to 1.5 frames/s). The MCU must render locally from compact data: send the track's waveform once (e.g. a few bytes per column) plus per-frame playhead/tempo packets; even 2 decks x 800 columns x 3 bytes x 60 fps is only about 290 kB/s.
- LVGL benchmark fps understates a purpose-built waveform renderer (a scrolling waveform is mostly vertical-line fills, and can be drawn directly into the framebuffer without LVGL), but the S3's PSRAM-framebuffer bandwidth sharing is a hard ceiling, so plan for about 20 to 30 fps full-width scrolling at 800x480 on S3 and about 60 fps on P4.
- An ESP32-P4/S3 board can also be the controls MCU (encoder on GPIO, composite USB CDC + HID/MIDI via TinyUSB), making it a one-board, one-USB-cable build with no HDMI. Trade-off: all UI must be written as firmware (C/LVGL), far slower iteration than a web/desktop UI on the laptop.
- Teensy 4.1 (fast CPU, high-speed USB) needs a separate display and typically drives SPI/parallel panels of 480x320 to 800x480; by the time a panel is added it costs more than a CrowPanel P4 for a worse screen.

### Gaps
- No frame-rate numbers specifically for a scrolling waveform (as opposed to the LVGL benchmark suite) on S3 or P4; no measured CDC throughput on the P4 high-speed port.
- RP2350 DVI/HSTX capability (resolution limits, boards such as Adafruit Fruit Jam / Pico DVI) returned no results and is unresearched. LilyGO T-Display and the 2.8 inch "Cheap Yellow Display" (ESP32-2432S028) prices were not found; at 320x240 they are too small for a waveform anyway (my judgement).
- Waveshare ESP32-P4 7 inch boards: no listing or price retrieved.

## 5. Architecture D, reuse a phone or tablet as the screen

### Takeaway
A phone or tablet the student already owns is the cheapest option ($0): either as a browser client of a laptop-hosted web app (Wi-Fi or USB tethering) or as a second monitor via spacedesk (Windows, free), Duet (paid) or Sidecar (Apple only). No source gave measured latency; guides consistently say wired/USB is lower-latency and more stable than Wi-Fi.

### Cited Findings
- spacedesk lists USB separately from Wi-Fi; USB is "lower latency, more stable"; Android needs USB tethering for the cable connection — [MakeUseOf](https://www.makeuseof.com/windows-11-android-tablet-second-screen/); [Make Tech Easier](https://maketecheasier.com/use-android-tablet-as-second-screen)
- Users unhappy with wireless spacedesk/Splashtop performance are advised to try network tethering over USB (anecdotal) — [MSFS forum](https://forums.flightsimulator.com/t/you-dont-need-spacedesk-we-already-have-spacedesk-at-home-or-how-i-stopped-worrying-and-learned-to-use-two-ipads-at-once/588388)
- Duet Display rated "very low" latency especially wired; now subscription (about $20/year per one source; formerly $14.99 one-off) — [Parka Blogs](https://www.parkablogs.com/content/how-use-tablet-second-monitor)
- Sidecar is Apple-only (iPad + Mac), free, "very low" latency — [Parka Blogs](https://www.parkablogs.com/content/how-use-tablet-second-monitor)
- If buying: Amazon Fire HD 8 (64GB) $90 on sale (list $130), Fire HD 10 (64GB) $130 (list $180) in Aug 2026; Fire HD 8 64GB with lockscreen ads $84.99; these run Fire OS, not stock Android — [9to5Toys, 18 Aug 2026](https://9to5toys.com/2026/08/18/prime-day-pricing-amazon-fire-tablets/); [Android Central](https://www.androidcentral.com/tablets/amazon-fire-tablet/amazon-is-slashing-prices-on-its-fire-tablet-lineup-including-50-percent-off-the-fire-hd-10)

### Inferences
- A web app (laptop serves a page + WebSocket; device renders the waveform locally in canvas/WebGL) avoids video-compression latency entirely because only data crosses the link; only the playhead timestamp needs to be low-jitter. That makes it the best-latency variant of D and the same code runs in a Pi Chromium kiosk (Architecture B).
- Second-monitor apps (spacedesk/Duet/Sidecar) compress and stream video, so they add encode/decode latency and can stutter on busy venue Wi-Fi; use USB tethering if going this route.
- Downsides versus a dedicated panel: phone aspect ratio (about 20:9) is fine as a bar, but mounting, auto-lock, notifications, and battery heat are practical nuisances; a new tablet ($85 to $130) costs as much as a dedicated 11.26 inch touch bar.

### Gaps
- No millisecond latency measurements for spacedesk, Duet, Sidecar or a WebSocket web app were found.
- No source on browser canvas performance on low-end Fire tablets.

## 6. Controls: encoder, buttons, touch and how to present them to the laptop

### Takeaway
A $5 Raspberry Pi Pico 2 (or any RP2040/ATmega32U4 board) with a $1.50 to $5 EC11 push encoder and a few buttons, enumerating as class-compliant USB MIDI (or HID keyboard), is the standard solution; mature libraries exist for both Arduino (Control Surface) and CircuitPython (rotaryio + usb_midi).

### Cited Findings
- Raspberry Pi Pico 2 (RP2350): $5 list, Pico 2 W $7 (product brief March 2026); $5.75 at SparkFun — [Raspberry Pi Pico 2](https://raspberrypi.com/products/raspberry-pi-pico-2/); [SparkFun](https://www.sparkfun.com/raspberry-pi-pico-2.html)
- EC11 rotary encoder with push switch: about $1.60 each in 5-packs (eBay $7.99/5), $4.25 single, breakout module $3.51 at RobotShop — [eBay 5-pack](https://www.ebay.com/itm/186620518931); [RobotShop EC11 module](https://robotshop.com/en/ec11-rotary-encoder-module.html)
- Control Surface (Arduino library): MIDI over USB / BLE / DIN, supports Raspberry Pi Pico; `CCRotaryEncoder` sends relative CC from a quadrature encoder wired to ground with internal pull-ups — [Control Surface](https://github.com/tttapa/Control-Surface); [RotaryEncoder example](https://tttapa.github.io/Control-Surface/Doxygen/d2/d1f/RotaryEncoder_8ino-example.html)
- CircuitPython: encoder decoding is done in the C `rotaryio` module; on Pico the encoder's two pins must be consecutive GPIOs — [todbot pico8enc](https://github.com/todbot/pico8enc)
- Reference builds: Pico with 4 encoders + 13 buttons as a USB HID keyboard (KY-040 modules work) — [touchgadget usb_keyboard_button_box_pico](https://WWW.GITHUB.COM/touchgadget/usb_keyboard_button_box_pico); Pico arcade-button USB MIDI controller in CircuitPython — [DigiKey maker project](https://www.digikey.com/en/maker/projects/raspberry-pi-pico-and-led-arcade-button-midi-controller/15ca54b64bc5420da9694050a0953393); Adafruit 4x4 rotary-encoder MIDI messenger — [Adafruit](https://learn.adafruit.com/4x4-rotary-encoder-midi-messenger.md?view=all)
- Touch panels from section 2 present as driver-free USB HID touch on Windows/Linux — [Waveshare 12.3inch HDMI LCD](https://www.waveshare.com/12.3inch-hdmi-lcd.htm)

### Inferences
- Prefer USB MIDI over HID keyboard: DJ software (rekordbox, Serato, Mixxx, djay) and a custom companion app can both MIDI-learn a second device, a relative-CC encoder maps cleanly to browse, and there is no risk of stray keystrokes going to the focused window. Use HID only if the companion app is the sole consumer.
- A CDJ-style minimum is one push encoder (browse / load), Back, Load A/Load B, and optionally a second encoder for waveform zoom: 2 encoders + 4 to 6 buttons uses about 10 to 12 GPIO, well within a Pico.
- In Architectures B and C the encoder can go straight to the SBC GPIO or the ESP32 instead, but a separate Pico keeps controls working as a plain USB device regardless of the display path.
- QMK/KMK (keyboard firmwares) also support encoders and MIDI on RP2040/Pro Micro but were not researched here.

### Gaps
- Pro Micro (ATmega32U4), QMK/KMK, Arduino MIDIUSB and TinyUSB specifics, and original Pico (RP2040) current price were not retrieved.
- No source checked on whether rekordbox in Performance mode accepts a second generic MIDI device alongside an FLX2/FLX4 for browse/load (it has MIDI learn, but confirm).

## 7. Power and connectivity: single cable, hubs, bus-power budget

### Takeaway
Both controllers are rated 5 V / 500 mA on USB bus power, so controller + display (about 0.3 to 0.5 A) + MCU exceeds a 900 mA USB 3 Type-A port or any bus-powered hub; plan on a laptop USB-C port that sources 1.5 to 3 A, or a hub/dock with its own power input. True single-cable video needs DisplayPort Alt Mode, which cheap HDMI bar panels do not accept directly.

### Cited Findings
- DDJ-FLX4: USB bus power DC 5 V, 500 mA; via USB power adapter DC 9 V, 3 A; two USB-C ports (one host, one power-only for phone/tablet use) — [Pioneer DJ FLX4 specifications](https://www.pioneerdj.com/en-us/product/controller/ddj-flx4/black/specifications/); [Full Compass](https://www.fullcompass.com/prod/615689-pioneer-ddj-flx4-2-channel-dj-controller-for-rekordbox-and-serato-dj-lite)
- DDJ-FLX2: power consumption DC 5 V, 500 mA, powered over USB-C from the connected device — [AlphaTheta FLX2 announcement](https://alphatheta.com/en/information/introducing-ddj-flx2-compact-2-channel-dj-controller/); [FLX2 spec sheet](https://cdn.teufelaudio.com/products/AlphaTheta/DDJ-FLX2/DDJ-FLX2-spec-sheet-HR)
- USB current levels: default 500 mA (USB 2.0) / 900 mA (USB 3.1); Type-C can advertise 1.5 A ("medium") or 3 A ("high") at 5 V — [TI TUSB320 datasheet](https://ti.com/document-viewer/TUSB320/datasheet/GUID-3BF156CA-3E11-436F-8D41-07D491DBA492)
- Some laptop USB-C ports give only 900 mA; others 1.5 A or 3 A (7.5 / 15 W) — [Plugable KB](https://kb.plugable.com/en_US/usb-charging-battery-powered-devices); Chromebook Type-C ports typically source 1.5 A, up to 3 A in some cases — [ChromiumOS EC docs](https://chromium.googlesource.com/chromiumos/platform/ec/+/6555d8eefedd62af8f0b0e890cb3e696690a76cc/docs/usb_power.md)
- A bus-powered hub's total draw from the upstream port is limited to 500 mA (USB 2) — [TI TPS2066C notes](https://ti.com/document-viewer/TPS2066C/datasheet/power_supply_recommendations); a typical bus-powered USB-C hub offers 900 mA total on USB 3 hosts, 500 mA on USB 2 — [Plugable USBC-HUB4A](https://plugable.com/products/usbc-hub4a)
- Display loads found: Waveshare 8.8 inch side monitor about 500 mA at full brightness — [The Pi Hut](https://thepihut.com/products/8-8-ips-hdmi-side-monitor-480x1920); VoCore screen about 300 mA and wants a powered hub with enough current — [vonger.cn](https://vonger.cn/?p=15359)
- Field lesson: a Raspberry Pi "could not deliver enough current to the USB port of a cheap controller" — [Mixxx guest article](https://mixxx.org/news/2020-08-22-portable-mixxx-setup)
- Single-cable video+power needs USB-C DisplayPort Alt Mode / Thunderbolt on the laptop; not all USB-C ports have it — [BGR](https://bgr.com/2119644/best-budget-expensive-portable-monitors-2026); portable monitors such as KYY K3 accept video + power over one USB-C — [TechRadar](https://techradar.com/pro/the-kyy-k3-portable-monitor-is-cheap-but-remarkably-cheerful-now-our-favorite-budget-display-drops-to-under-usd60)

### Inferences
- Budget: controller 0.5 A + bar display about 0.5 A + Pico (tens of mA, unsourced) is about 1.05 A / 5.3 W at 5 V. That is over the 900 mA USB 3 default and over any bus-powered hub's total, but within a Type-C port advertising 1.5 A. Dim the backlight (dark booth) to gain margin; add a USB-C power-input (PD pass-through) on the hub as the safe default.
- Practical single-cable recipe for HDMI bar panels: put a small USB-C multiport hub (HDMI out + 2 to 3 USB-A + PD input) inside the enclosure. Laptop USB-C (DP Alt Mode) goes to the hub; hub HDMI goes to the panel; hub USB-A ports feed panel touch/power, the Pico, and the FLX controller. One cable to the laptop, optional charger into the hub's PD port. Laptops without DP Alt Mode need a separate HDMI cable.
- Audio caution: the FLX2/FLX4 contain the USB audio interface; routing them through a cheap hub adds a dropout risk. Safer default is controller on its own laptop port and the screen unit on a second port; offer the hub pass-through only as a convenience. (General USB-audio practice; not sourced in this session.)
- The FLX4's second USB-C (power-only) port could take 5 V from the screen unit's supply only in the phone/tablet use case; with a computer it is bus-powered from the host port.

### Gaps
- Measured (not rated) current of FLX2/FLX4 was not found; 500 mA is the rated maximum.
- No price or model data retrieved for USB-C hubs with HDMI + PD; no source confirming FLX audio stability through hubs.
- Whether any small bar display accepts DP Alt Mode over USB-C directly (true one-cable, no hub) was not confirmed; one 8.8 inch listing advertises "HDMI + USB-C" but the role of USB-C is unstated.

## 8. Existing DIY builds and lessons learned

### Takeaway
Prior art is almost entirely "Mixxx/xwax on a Raspberry Pi with the official 7 inch touchscreen" as a laptop replacement; no project was found that does exactly this (a companion waveform screen for rekordbox on an FLX controller fed by the laptop). The recurring lessons are: 800x480 is too cramped for a full DJ UI, USB power to the controller is a trap, and waveform rendering is the GPU bottleneck.

### Cited Findings
- TriMixxx (Oct 2026): DIY CDJ by Samuel Prevost; Raspberry Pi 4 running a Mixxx 2.5.6 fork with a single-deck CDJ-style skin on a 10.1 inch touchscreen, jog from a CDJ-1000MK3, custom KiCad boards with RISC-V MCUs, reverse-engineered Pro DJ Link; explicitly not a product — [DJ TechTools](https://djtechtools.com/2026/10/16/trimixxx-is-a-diy-cdj-built-on-a-raspberry-pi/)
- Standalone DDJ-400 (2020, TimewasterNL): Pi 4B + official 7 inch Raspberry Pi touchscreen in a SmartiPi Touch 2 case, Pi and screen sharing one USB-C charger via splitter; Mixxx skin had to be made resizable to fit 800x480; used an in-development DDJ-400 mapping (since merged in Mixxx 2.3) — [DJ TechTools](https://djtechtools.com/2020/11/05/building-a-standalone-ddj-400-with-a-raspberry-pi-and-mixxx/); [Mixxx wiki DDJ-400](https://mixxx.org/wiki/doku.php/Pioneer%20DDJ-400)
- Mixxx on Pi 3 (2020 guest article): under 20 ms latency, no underruns with a controller that has its own sound card; a small touchscreen is impractical, get a larger one; the Pi could not power a cheap controller over USB — [Mixxx](https://mixxx.org/news/2020-08-22-portable-mixxx-setup); [Hackaday](https://hackaday.com/2020/07/03/djing-without-the-truckload-of-equipment-secret-ingredient-is-raspberry-pi)
- An old report of no waveforms at all on Pi 4 (2020, renderer/driver issue) — [Mixxx bug 1867152](https://bugs.launchpad.net/mixxx/+bug/1867152)
- Ready-made images/configs: mixxx-pi-gen (Pi 3/4/400/5) — [fayaaz/mixxx-pi-gen](https://github.com/fayaaz/mixxx-pi-gen); pi_dj configs and skins — [dennisdebel/pi_dj](https://github.com/dennisdebel/pi_dj)
- PiDeck (64 Studio, 2016 to 2018): xwax DVS on a Pi 3B (later Pi 2/3) with the official 7 inch touchscreen (single-touch is enough), music from USB stick, about GBP 150 per deck; v0.2 added CDJ control — [Raspberry Pi Magazine](https://magazine.raspberrypi.com/articles/pi-deck); [DJ TechTools 2016](https://djtechtools.com/2016/10/31/pideck-standalone-dvs-control-raspberry-pi/); [DJ TechTools 2018](https://djtechtools.com/2018/06/06/pideck-0-2-coming-soon-any-old-cdj-raspberry-pi-a-standalone-deck/); [pideck GitHub](https://github.com/pideck/pideck)
- Cornell ECE 5725 "PiDeck" student DJ controller: ran short of GPIO while also driving a display for song selection — [Cornell ECE5725](https://courses.ece.cornell.edu/ece5990/ECE5725_Spring2024_Projects/02%20Monday%20May%2013/09%20PiDeck/Wednesday_cds258_jtg239/index.html)
- Sim-racing dashboards are the closest "companion screen fed by PC telemetry" ecosystem: SimHub drives USB VoCore screens and HDMI bar displays; VoCore units have notable reliability/cable-quality complaints — [SimHub: external dashboard options](https://www.simhubdash.com/external-graphic-dashboard-what-are-the-options-what-to-choose/); [SimHub forum](https://www.simhubdash.com/community-2/simhub-support/vocore-lcd-not-showing); [Overtake thread](https://www.overtake.gg/threads/vocore-screen-with-simhub.196602/)

### Inferences
- Lessons to carry over: (1) choose at least 1024x600, ideally 1280x400+ bar or 1280x800; builders had to rework skins for 800x480. (2) Give the controller its own adequately powered USB port. (3) Single-touch is sufficient (PiDeck, CDJ-3000). (4) Keep the UI purpose-built (one or two waveforms + track info + browse), not a shrunken full DJ app. (5) Use a separate MCU for controls instead of SBC GPIO.
- The sim-racing pattern (PC app pushes telemetry, cheap HDMI bar renders a dashboard as a second monitor) maps directly onto Architecture A and validates the 8.8 to 12.3 inch bar form factor for this build.
- The absence of prior art for a laptop-fed companion screen suggests the hard part is software (getting waveform/playhead data out of the DJ software), not hardware.

### Gaps
- Could not open the DJTT articles for BOM detail (screen model, audio interface, cost) on TriMixxx or the DDJ-400 build; no GitHub repo found for TriMixxx.
- No YouTube/Reddit build logs retrieved; no ESP32-based DJ display projects found.

## 9. Recommended bill-of-materials tiers (excluding 3D-printed enclosure)

### Takeaway
Recommended default is Architecture A (dumb HDMI touch panel driven by the laptop) plus a Pico 2 USB-MIDI control board: about $55 with a 7 inch 1024x600 panel, about $115 to $140 with an 11.26 inch 1920x440 touch bar, and about $200 to $260 with either a 12.3 inch 1920x720 bar or a Pi 5-driven smart unit. Start at $0 by prototyping the UI as a web app on an existing phone or tablet.

### Cited Findings
Tier 0, prototype / cheapest possible (about $10 to $15):
- Screen: existing phone/tablet as web-app client or second monitor (spacedesk free on Windows; Sidecar free on Apple) — [MakeUseOf](https://www.makeuseof.com/windows-11-android-tablet-second-screen/); [Parka Blogs](https://www.parkablogs.com/content/how-use-tablet-second-monitor)
- Controls: Raspberry Pi Pico 2 $5 to $5.75 — [SparkFun](https://www.sparkfun.com/raspberry-pi-pico-2.html); EC11 push encoder $1.60 to $4.25 — [eBay](https://www.ebay.com/itm/186620518931); [RobotShop](https://robotshop.com/en/ec11-rotary-encoder-module.html)

Tier 1, cheapest dedicated unit (target under $60):
- Option 1A (recommended): Waveshare 7inch HDMI LCD (C) 1024x600 IPS capacitive, $42.29 to $43.99 direct, or (H) $46.29 to $47.99 direct / $56.56 US-landed at RobotShop — [Waveshare](https://www.waveshare.com/product/displays/lcd-oled/lcd-oled-1.htm?dir=asc&p=2); [RobotShop](https://www.robotshop.com/products/7-in-hdmi-lcd-1024x600-ips-capacitive-touch-screen); plus Pico 2 $5 and EC11 about $2 to $4 (sources above). Sum of sourced parts: about $50 to $66.
- Option 1B (MCU, single USB cable, more firmware work): Elecrow CrowPanel Advanced 7 inch ESP32-P4 1024x600, $45.90 to $48.90 — [CNX Software](https://www.cnx-software.com/2025/10/26/crowpanel-advance-7-inch-esp32-p4-hmi-display-supports-zigbee-lora-and-2-4ghz-radio-modules/); [Elecrow](https://www.elecrow.com/crowpanel-advanced-7inch-esp32-p4-hmi-ai-display-1024x600-ips-touch-screen-with-wifi-6-compatible-with-arduino-lvgl-micropython.html); budget fallback CrowPanel 7.0 ESP32-S3 800x480 $29.17 to $42.90 — [Elecrow](https://www.elecrow.com/esp32-display-7-inch-hmi-display-rgb-tft-lcd-touch-screen-support-lvgl.html) or Sunton ESP32-8048S070 $21 to $28 — [atomic14](https://www.atomic14.com/esp32/boards/sunton-esp32-8048s070/) (about 12 to 25 fps class per section 4).
- Option 1C (biggest screen per dollar, no touch): 15.6 inch 1080p USB-C portable monitor, KYY K3 $60 on sale — [TechRadar](https://techradar.com/pro/the-kyy-k3-portable-monitor-is-cheap-but-remarkably-cheerful-now-our-favorite-budget-display-drops-to-under-usd60)

Tier 2, balanced (target $100 to $150):
- Display: GeeekPi 11.26 inch 1920x440 HDMI capacitive touch $89.99 (Amazon, updated 2026-04-23) — [GeeekPi](https://specpicks.com/product/B0F6NPCX1V); or 52Pi equivalent $99 — [52Pi](https://52pi.com/products/52pi-11-26-inch-capacitive-touch-screen-1920x440-hdmi-display-screen-with-speakers-for-raspberry-pi-5-4b-3b-3b); alternative Waveshare 7.9 inch 400x1280 touch $91.58 — [RobotShop](https://www.robotshop.com/products/waveshare-79-capacitive-touch-screen-lcd-4001280-hdmi-ips-toughened-glass-cover); or 8.8 inch 1920x480 touch $78.99 to $117.97 — [Walmart](https://www.walmart.com/ip/17362917650)
- Controls: Pico 2 $5 to $5.75 + 2x EC11 (sources above).

Tier 3, best (target $200 to $300):
- Option 3A (dumb, largest bar): 12.3 inch 1920x720: Waveshare 12.3inch HDMI LCD 10-point touch GBP 105.60 at The Pi Hut — [The Pi Hut](https://thepihut.com/products/12-3-ips-capacitive-10-point-touch-display-1920x720); or bare HSD123KPW1 panel + HDMI/Type-C driver board EUR 109.99 to US $149.99 (no touch) — [eBay](https://www.ebay.de/itm/396776395375)
- Option 3B (smart, standalone-capable): Raspberry Pi 5 2GB $77.50 (or 1GB $45) — [Phoronix](https://www.phoronix.com/news/Raspberry-Pi-5-2GB-Price-77.50); plus 11.26 inch touch bar $89.99 to $99 (above) or Waveshare 10.1 inch 1280x800 touch with case $110.99 direct (CDJ-3000X resolution) — [Waveshare](https://www.waveshare.com/10.1inch-hdmi-lcd-b-with-case.htm); plus Pico 2 controls.

### Inferences
- Tier totals with unsourced sundries (my estimates, not from sources): cables and micro-HDMI/USB leads about $8 to $12; tact buttons, wire, standoffs about $5; USB-C hub with HDMI + PD about $15 to $25; Pi 5 PSU + microSD + cooler about $30 to $40. Resulting totals: Tier 1A about $60 to $75 landed in the US (about $55 if ordered direct from Waveshare and tariffs/shipping are favourable); Tier 2 about $115 to $140 (with hub); Tier 3A about $190 to $240; Tier 3B about $215 to $265.
- Why A over B/C by default: the laptop already holds the track data and has a far stronger GPU; an HDMI panel gives native 60 Hz with zero boot time, and the UI is ordinary desktop/web code. An SBC adds $75+ at 2026 prices plus PSU, boot delay and a sync protocol; an ESP32-S3 cannot reach 60 fps; ESP32-P4 can but requires writing the whole UI as firmware.
- Suggested build path: (1) Tier 0 web-app prototype on a phone to settle layout and data protocol; (2) buy the Tier 2 11.26 inch touch bar if the layout is "two stacked waveforms", or the Tier 1A 7 inch / 10.1 inch if it is "one CDJ-style deck screen"; (3) add the Pico 2 encoder board; (4) only add a Pi 5 later if laptop-free operation becomes a goal. Keeping the renderer as a web app makes steps 1, 2 and 4 share one codebase.
- Fit: 11.26 inch (about 279 mm active) spans about 73% of an FLX2 and 58% of an FLX4, leaving room for encoder/buttons beside it in a controller-width enclosure; the 12.3 inch (292 x 110 mm) is the closest to a twin-CDJ display but roughly doubles the cost.

### Gaps
- Sundries (cables, hub, buttons, Pi PSU/SD) are unsourced estimates. GBP/EUR prices were not converted with a sourced exchange rate, and US tariff/shipping on direct-from-China orders is not included in Waveshare/Elecrow list prices (RobotShop US prices, which include tariffs, run about 20% to 100% higher than Waveshare direct).
- Several prices are undated store listings or early/mid-2026 snapshots; 2026 component inflation means late-2026 prices may be higher. Amazon and AliExpress could not be queried directly.
- Hosts that must be allowed in the session's network settings for direct verification: www.pioneerdj.com, www.waveshare.com, www.tomshardware.com, djtechtools.com, espressif2022.github.io (all failed DNS resolution here).
