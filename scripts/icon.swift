import AppKit

// Original Moose mark, drawn as vectors and rendered at every macOS icon size.
let output = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "build/icon.iconset"
try FileManager.default.createDirectory(atPath: output, withIntermediateDirectories: true)
for (name, pixels) in [("icon_16x16", 16), ("icon_16x16@2x", 32), ("icon_32x32", 32), ("icon_32x32@2x", 64), ("icon_128x128", 128), ("icon_128x128@2x", 256), ("icon_256x256", 256), ("icon_256x256@2x", 512), ("icon_512x512", 512), ("icon_512x512@2x", 1024)] {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    let scale = NSAffineTransform(); scale.scale(by: CGFloat(pixels) / 1024); scale.concat()
    NSColor(calibratedRed: 0.91, green: 0.94, blue: 0.95, alpha: 1).setFill()
    NSBezierPath(roundedRect: NSRect(x: 54, y: 54, width: 916, height: 916), xRadius: 204, yRadius: 204).fill()
    let transform = NSAffineTransform(); transform.translateX(by: 112, yBy: 920); transform.scaleX(by: 20, yBy: -20); transform.concat()
    NSColor(calibratedRed: 0.208, green: 0.42, blue: 0.439, alpha: 1).setStroke()
    let path = NSBezierPath(); path.lineWidth = 2.2; path.lineCapStyle = .round; path.lineJoinStyle = .round
    func line(_ points: [(CGFloat, CGFloat)]) { path.move(to: NSPoint(x: points[0].0, y: points[0].1)); for p in points.dropFirst() { path.line(to: NSPoint(x: p.0, y: p.1)) } }
    line([(15,22),(8,16),(6,8)]); line([(8,16),(3,14)]); line([(11,19),(12,9)])
    line([(25,22),(32,16),(34,8)]); line([(32,16),(37,14)]); line([(29,19),(28,9)])
    path.move(to: NSPoint(x:13,y:21)); path.curve(to:NSPoint(x:27,y:21), controlPoint1:NSPoint(x:13,y:18), controlPoint2:NSPoint(x:27,y:18)); path.line(to:NSPoint(x:25,y:32)); path.curve(to:NSPoint(x:15,y:32), controlPoint1:NSPoint(x:24.6,y:35), controlPoint2:NSPoint(x:15.4,y:35)); path.close()
    line([(17,26),(17,27)]); line([(23,26),(23,27)]); path.stroke()
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(output)/\(name).png"))
}
