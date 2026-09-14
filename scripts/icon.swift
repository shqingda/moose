// 应用图标生成器：读取共享驼鹿矢量数据，绘制不同分辨率的 macOS 图标。
import AppKit

// One vector master for the interface mark and every Dock icon resolution.
let mark = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: "src/assets/moose-mark.json"))) as! [String: String]
// 把共享数据中的 M/L/C/Z 命令转换成可缩放的 AppKit 路径。
func path(_ source: String) -> NSBezierPath {
    let tokens = source.split(separator: " ").map(String.init)
    let shape = NSBezierPath(); shape.windingRule = .evenOdd
    var i = 0
    func point() -> NSPoint { let p = NSPoint(x: Double(tokens[i])!, y: Double(tokens[i + 1])!); i += 2; return p }
    while i < tokens.count {
        let command = tokens[i]; i += 1
        switch command {
        case "M": shape.move(to: point())
        case "L": shape.line(to: point())
        case "C": let a = point(); let b = point(); let end = point(); shape.curve(to: end, controlPoint1: a, controlPoint2: b)
        case "Z": shape.close()
        default: fatalError("Unsupported vector command")
        }
    }
    return shape
}
let output = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "build/icon.iconset"
try FileManager.default.createDirectory(atPath: output, withIntermediateDirectories: true)
for (name, pixels) in [("icon_16x16",16),("icon_16x16@2x",32),("icon_32x32",32),("icon_32x32@2x",64),("icon_128x128",128),("icon_128x128@2x",256),("icon_256x256",256),("icon_256x256@2x",512),("icon_512x512",512),("icon_512x512@2x",1024)] {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:pixels,pixelsHigh:pixels,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
    NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep:bitmap)
    let scale = NSAffineTransform(); scale.scale(by:CGFloat(pixels)/1024); scale.concat()
    let tile = NSBezierPath(roundedRect:NSRect(x:54,y:54,width:916,height:916),xRadius:204,yRadius:204)
    NSColor(calibratedRed:0.13,green:0.22,blue:0.23,alpha:1).setFill(); tile.fill()
    let transform = NSAffineTransform(); transform.translateX(by:100,yBy:943); transform.scaleX(by:8.2,yBy:-8.2); transform.concat()
    NSColor(calibratedRed:0.76,green:0.65,blue:0.45,alpha:1).setFill(); path(mark["antler"]!).fill()
    NSColor(calibratedRed:0.96,green:0.94,blue:0.87,alpha:1).setFill(); path(mark["head"]! + " " + mark["eye"]!).fill()
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:"\(output)/\(name).png"))
}
