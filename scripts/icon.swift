// 从拟物图标母版导出各分辨率 macOS 图标，保留透明边缘。
import AppKit

let source = "src/assets/moose-icon-skeuomorphic-v2.png"
guard let image = NSImage(contentsOfFile: source) else {
    fatalError("Cannot load icon master: \(source)")
}
let output = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "build/icon.iconset"
try FileManager.default.createDirectory(atPath: output, withIntermediateDirectories: true)

for (name, pixels) in [("icon_16x16",16),("icon_16x16@2x",32),("icon_32x32",32),("icon_32x32@2x",64),("icon_128x128",128),("icon_128x128@2x",256),("icon_256x256",256),("icon_256x256@2x",512),("icon_512x512",512),("icon_512x512@2x",1024)] {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:pixels,pixelsHigh:pixels,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    NSGraphicsContext.current?.imageInterpolation = .high
    image.draw(in: NSRect(x: 0, y: 0, width: pixels, height: pixels), from: .zero, operation: .copy, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:"\(output)/\(name).png"))
}
