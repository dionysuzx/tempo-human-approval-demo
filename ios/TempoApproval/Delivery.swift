import Foundation

struct DeliveryReceipt: Decodable {
    let posted: Bool
    let url: String
    let returnURL: String
    func destination(for approval: Approval) throws -> URL {
        let prefix = "https://github.com/\(approval.repository)/pull/\(approval.number)#issuecomment-"
        guard posted, url == returnURL, url.hasPrefix(prefix),
              String(url.dropFirst(prefix.count)).range(of:"^[1-9][0-9]*$",options:.regularExpression) != nil,
              let result = URL(string:url) else { throw ApprovalError.invalid("Invalid delivery receipt. Remain here and check GitHub manually.") }
        return result
    }
}

final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

func deliverProof(_ proof: String, approval: Approval, origin: String) async throws -> URL {
    guard let endpoint = URL(string:origin + "/api/deliver"), endpoint.scheme == "https" else { throw ApprovalError.invalid("HTTPS delivery is not configured.") }
    var request = URLRequest(url:endpoint)
    request.httpMethod = "POST"; request.timeoutInterval = 30
    request.setValue("application/json",forHTTPHeaderField:"Content-Type")
    request.httpBody = Data(("{\"proof\":" + proof + "}").utf8)
    let session = URLSession(configuration:.ephemeral,delegate:NoRedirects(),delegateQueue:nil)
    defer { session.invalidateAndCancel() }
    let (data,response) = try await session.data(for:request)
    guard let http=response as? HTTPURLResponse, http.statusCode == 200, data.count < 4096 else {
        throw ApprovalError.invalid("Delivery was not confirmed. Check the PR before retrying. Your signed proof is available below.")
    }
    return try JSONDecoder().decode(DeliveryReceipt.self,from:data).destination(for:approval)
}
