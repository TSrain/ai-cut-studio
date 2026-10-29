// matte.swift — 人像抠图 + 白描边烘焙
// 用 macOS Vision 的 VNGenerateForegroundInstanceMaskRequest 做前景实例分割,
// CoreImage 做 alpha 硬化(去半透明毛边)、裁切、缩放、形态学膨胀出白描边。
// 用法:
//   swiftc -O tools/matte.swift -o /tmp/matte
//   matte <in.jpg> <out.png> [--crop x,y,w,h] [--trim] [--width W] [--stroke R]
//         [--alpha-gamma K] [--instances all|1,2] [--dump-mask path]
//
// 人物剪贴卡的标配:--crop … --trim --alpha-gamma 3.2 --width <显示宽> --stroke 7
// --width 必须等于最终画布上的显示宽度,否则描边宽度会随 DOM 缩放漂掉。
import Foundation
import CoreImage
import CoreImage.CIFilterBuiltins
import Vision
import AppKit

func fail(_ m: String) -> Never {
    FileHandle.standardError.write((m + "\n").data(using: .utf8)!)
    exit(1)
}

var args = Array(CommandLine.arguments.dropFirst())
guard args.count >= 2 else { fail("usage: matte <in> <out> [opts]") }
let inPath = args.removeFirst()
let outPath = args.removeFirst()

var crop: (Int, Int, Int, Int)? = nil
var targetWidth: Int? = nil
var stroke: Double = 0
var alphaGamma: Double = 1.0
var instancesArg = "all"
var dumpMask: String? = nil
var doTrim = false

var i = 0
while i < args.count {
    let a = args[i]
    func next() -> String { i += 1; return args[i] }
    switch a {
    case "--crop":
        let p = next().split(separator: ",").map { Int($0)! }
        crop = (p[0], p[1], p[2], p[3])
    case "--width": targetWidth = Int(next())!
    case "--stroke": stroke = Double(next())!
    case "--alpha-gamma": alphaGamma = Double(next())!
    case "--instances": instancesArg = next()
    case "--dump-mask": dumpMask = next()
    case "--trim": doTrim = true
    default: fail("unknown arg \(a)")
    }
    i += 1
}

guard let src = CIImage(contentsOf: URL(fileURLWithPath: inPath)) else { fail("cannot read \(inPath)") }
let ctx = CIContext(options: [.workingColorSpace: CGColorSpace(name: CGColorSpace.sRGB)!])
let W = Int(src.extent.width), H = Int(src.extent.height)
FileHandle.standardError.write("source \(W)x\(H)\n".data(using: .utf8)!)

// ---- 1. Vision 前景实例分割 ----
let handler = VNImageRequestHandler(ciImage: src, options: [:])
let req = VNGenerateForegroundInstanceMaskRequest()
do { try handler.perform([req]) } catch { fail("vision failed: \(error)") }
guard let obs = req.results?.first else { fail("no foreground instance found") }
FileHandle.standardError.write("instances: \(obs.allInstances.sorted())\n".data(using: .utf8)!)

var instances: IndexSet = obs.allInstances
if instancesArg != "all" {
    instances = IndexSet(instancesArg.split(separator: ",").map { Int($0)! })
}
let maskBuf: CVPixelBuffer
do { maskBuf = try obs.generateScaledMaskForImage(forInstances: instances, from: handler) }
catch { fail("mask failed: \(error)") }
var mask = CIImage(cvPixelBuffer: maskBuf)
// 缩放到原图尺寸(generateScaledMask 已对齐,但保险起见)
if mask.extent.width != src.extent.width {
    let s = src.extent.width / mask.extent.width
    mask = mask.transformed(by: CGAffineTransform(scaleX: s, y: src.extent.height / mask.extent.height))
}

// alpha 硬化:mask' = clamp(((mask - 0.5) * gamma) + 0.5) —— 收掉 Vision 的半透明毛边
if alphaGamma != 1.0 {
    let m = CIFilter.colorMatrix()
    m.inputImage = mask
    m.rVector = CIVector(x: alphaGamma, y: 0, z: 0, w: 0)
    m.gVector = CIVector(x: 0, y: alphaGamma, z: 0, w: 0)
    m.bVector = CIVector(x: 0, y: 0, z: alphaGamma, w: 0)
    m.aVector = CIVector(x: 0, y: 0, z: 0, w: alphaGamma)
    let b = 0.5 - 0.5 * alphaGamma
    m.biasVector = CIVector(x: b, y: b, z: b, w: b)
    mask = m.outputImage!.applyingFilter("CIColorClamp")
}

if let dm = dumpMask {
    try! ctx.writePNGRepresentation(of: mask, to: URL(fileURLWithPath: dm),
                                    format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
}

// ---- 2. 用 mask 抠出主体(背景透明) ----
let blend = CIFilter.blendWithMask()
blend.inputImage = src
blend.backgroundImage = CIImage(color: .clear).cropped(to: src.extent)
blend.maskImage = mask
var cut = blend.outputImage!.cropped(to: src.extent)

// ---- 3. 裁切(参数用左上原点的像素坐标,CI 是左下原点) ----
if let c = crop {
    let rect = CGRect(x: CGFloat(c.0), y: CGFloat(H - c.1 - c.3), width: CGFloat(c.2), height: CGFloat(c.3))
    cut = cut.cropped(to: rect).transformed(by: CGAffineTransform(translationX: -rect.minX, y: -rect.minY))
}

// ---- 3b. 裁到 alpha 包围盒(布局可预测:PNG 边缘即人形边缘) ----
if doTrim {
    let w = Int(cut.extent.width), h = Int(cut.extent.height)
    guard let cg = ctx.createCGImage(cut, from: cut.extent) else { fail("trim: cgimage failed") }
    var buf = [UInt8](repeating: 0, count: w * h * 4)
    let bctx = CGContext(data: &buf, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                         space: CGColorSpace(name: CGColorSpace.sRGB)!,
                         bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    bctx.draw(cg, in: CGRect(x: 0, y: 0, width: CGFloat(w), height: CGFloat(h)))
    var minX = w, maxX = -1, minY = h, maxY = -1
    for y in 0..<h {
        for x in 0..<w where buf[(y * w + x) * 4 + 3] > 24 {
            if x < minX { minX = x }; if x > maxX { maxX = x }
            if y < minY { minY = y }; if y > maxY { maxY = y }
        }
    }
    guard maxX >= 0 else { fail("trim: fully transparent") }
    // CGBitmapContext 的内存是自上而下的(row 0 = 图像顶行),而 CIImage 原点在左下 → 必须翻 y。
    // 这一步错了不会报错,只会把包围盒从错误的一侧裁掉,画面上表现为「人像莫名偏下 + 顶部一片空」。
    let r = CGRect(x: CGFloat(minX), y: CGFloat(h - 1 - maxY),
                   width: CGFloat(maxX - minX + 1), height: CGFloat(maxY - minY + 1))
    FileHandle.standardError.write("trim bbox \(Int(r.width))x\(Int(r.height))\n".data(using: .utf8)!)
    cut = cut.cropped(to: r).transformed(by: CGAffineTransform(translationX: -r.minX, y: -r.minY))
}

// ---- 4. 缩放到目标像素宽(描边宽度按最终画布像素计算) ----
if let tw = targetWidth {
    let s = CGFloat(tw) / cut.extent.width
    let f = CIFilter.lanczosScaleTransform()
    f.inputImage = cut
    f.scale = Float(s)
    f.aspectRatio = 1
    cut = f.outputImage!
    cut = cut.transformed(by: CGAffineTransform(translationX: -cut.extent.minX, y: -cut.extent.minY))
}

var result = cut
var extent = cut.extent

// ---- 5. 白描边:形态学膨胀 alpha → 纯白层 → 主体压在上面 ----
if stroke > 0 {
    let pad = ceil(stroke) + 2
    let padded = cut.clampedToExtent().cropped(to: cut.extent.insetBy(dx: -pad, dy: -pad))
    // CIMorphologyMaximum 用圆盘核 → 接缝天然是圆角
    let dil = padded.applyingFilter("CIMorphologyMaximum", parameters: [kCIInputRadiusKey: stroke])
    // 把膨胀结果染成纯白(保留 alpha):premultiplied 下 RGB=A 即为白
    let wm = CIFilter.colorMatrix()
    wm.inputImage = dil
    wm.rVector = CIVector(x: 0, y: 0, z: 0, w: 1)
    wm.gVector = CIVector(x: 0, y: 0, z: 0, w: 1)
    wm.bVector = CIVector(x: 0, y: 0, z: 0, w: 1)
    wm.aVector = CIVector(x: 0, y: 0, z: 0, w: 1)
    let white = wm.outputImage!.cropped(to: cut.extent.insetBy(dx: -pad, dy: -pad))
    let over = CIFilter.sourceOverCompositing()
    over.inputImage = cut
    over.backgroundImage = white
    result = over.outputImage!
    extent = cut.extent.insetBy(dx: -pad, dy: -pad)
}

result = result.cropped(to: extent).transformed(
    by: CGAffineTransform(translationX: -extent.minX, y: -extent.minY))

try! ctx.writePNGRepresentation(of: result, to: URL(fileURLWithPath: outPath),
                                format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
FileHandle.standardError.write("wrote \(outPath) \(Int(result.extent.width))x\(Int(result.extent.height))\n".data(using: .utf8)!)
