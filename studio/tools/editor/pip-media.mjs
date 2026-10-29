/** Assign footage without replacing or retiming the document main source. */
export function assignPipMedia(props,meta,kind) {
 return {...props,sourceMode:'media',crop:undefined,
  entrance:props.entrance==='shrink'?'fade':props.entrance,
  exit:props.exit==='expand'?'fade':props.exit,
  media:{kind,publicPath:meta.publicPath,width:meta.canvas?.width??meta.width,height:meta.canvas?.height??meta.height,
   ...(kind==='video'?{durationSeconds:meta.durationSeconds,startSeconds:0,hasAlpha:meta.hasAlpha===true,...(meta.previewPublicPath?{previewPublicPath:meta.previewPublicPath}:{})}:{})}};
}
