export function returnDestination(receipt, request) {
  const prefix=request.githubURL+'#issuecomment-';
  if(receipt?.posted!==true || typeof receipt.url!=='string' || !receipt.url.startsWith(prefix) || !/^[1-9][0-9]*$/.test(receipt.url.slice(prefix.length)))throw Error('Delivery was not confirmed for this PR.');
  return receipt.url;
}
