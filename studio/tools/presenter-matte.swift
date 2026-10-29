import Foundation
import Vision
import CoreImage
import CoreImage.CIFilterBuiltins
let args=CommandLine.arguments
if args.count != 3 { fatalError("usage: presenter-matte input-frames output-frames") }
let fm=FileManager.default
try fm.createDirectory(atPath:args[2],withIntermediateDirectories:true)
let context=CIContext()
let request=VNGeneratePersonSegmentationRequest()
request.qualityLevel = .accurate
request.outputPixelFormat=kCVPixelFormatType_OneComponent8
let handler=VNSequenceRequestHandler()
for name in try fm.contentsOfDirectory(atPath:args[1]).filter({$0.hasSuffix(".png")}).sorted(){
 let image=CIImage(contentsOf:URL(fileURLWithPath:args[1]+"/"+name))!
 do { try handler.perform([request],on:image) } catch {
  FileHandle.standardError.write("Vision segmentation failed: \(error). Local system model/IOSurface access is required.\n".data(using:.utf8)!)
  exit(1)
 }
 guard let pixel=request.results?.first?.pixelBuffer else {fatalError("No person mask for \(name)")}
 var mask=CIImage(cvPixelBuffer:pixel)
 mask=mask.transformed(by:CGAffineTransform(scaleX:image.extent.width/mask.extent.width,y:image.extent.height/mask.extent.height))
 let blend=CIFilter.blendWithMask();blend.inputImage=image;blend.maskImage=mask;blend.backgroundImage=CIImage(color:.clear).cropped(to:image.extent)
 try context.writePNGRepresentation(of:blend.outputImage!.cropped(to:image.extent),to:URL(fileURLWithPath:args[2]+"/"+name),format:.RGBA8,colorSpace:CGColorSpace(name:CGColorSpace.sRGB)!)
}
