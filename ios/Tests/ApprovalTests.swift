import XCTest
@testable import ApprovalCore
final class ApprovalTests: XCTestCase {
    let now = Date(timeIntervalSince1970:1000)
    var message: String { "Approve this GitHub pull request\n\nRepository: dionysuzx/tempo-human-approval-demo\nRepository ID: 42\nPull request: #5\nAction: allow this change to merge into main\nHead commit: \(String(repeating:"a",count:40))\nBase commit: \(String(repeating:"b",count:40))\nRequest: 00000000-0000-4000-8000-000000000000\nExpires: 1970-01-01T00:20:00.000Z" }
    func testExactAction() throws {
        let request = try Approval.parse(message,now:now)
        XCTAssertEqual(request.number,5); XCTAssertEqual(request.message,message)
        XCTAssertEqual(request.githubURL.host,"github.com")
    }
    func testRejectsChangedDomainActionAndExpired() {
        for value in [message + "\n", message.replacingOccurrences(of:"main",with:"evil"),message.replacingOccurrences(of:"dionysuzx/",with:"attacker/"),message.replacingOccurrences(of:"00:20:00",with:"00:10:00"),message.replacingOccurrences(of:"#5",with:"#5\r")] {
            XCTAssertThrowsError(try Approval.parse(value,now:now))
        }
    }
    func testURLTrustAndFormEncoding() throws {
        var url = URLComponents(string:"https://approval.example/native")!
        var fragment = URLComponents(); fragment.queryItems = [URLQueryItem(name:"message",value:message)]
        url.percentEncodedFragment = fragment.percentEncodedQuery!.replacingOccurrences(of:"%20",with:"+")
        XCTAssertEqual(try Approval.fromURL(url.url!,origin:"https://approval.example",now:now).message,message)
        for bad in [url.string!.replacingOccurrences(of:"https:",with:"http:"),url.string!.replacingOccurrences(of:"approval.example",with:"attacker.example"),url.string!.replacingOccurrences(of:"/native",with:"/other"), url.string! + "&message=duplicate"] {
            XCTAssertThrowsError(try Approval.fromURL(URL(string:bad)!,origin:"https://approval.example",now:now))
        }
    }
    func testDeliveryReceiptMustConfirmExactPR() throws {
        let request = try Approval.parse(message,now:now)
        let good = "https://github.com/dionysuzx/tempo-human-approval-demo/pull/5#issuecomment-123"
        XCTAssertEqual(try DeliveryReceipt(posted:true,url:good,returnURL:good).destination(for:request).absoluteString,good)
        for url in ["https://evil.test",good + "?return=evil",good.replacingOccurrences(of:"/5#",with:"/6#")] {
            XCTAssertThrowsError(try DeliveryReceipt(posted:true,url:url,returnURL:url).destination(for:request))
        }
        XCTAssertThrowsError(try DeliveryReceipt(posted:false,url:good,returnURL:good).destination(for:request))
    }
    func testWireFramingUsesUTF8ByteLengths() {
        let proof = NativeProof(origin:"é",requestID:"",nonce:"",expiresAt:"",message:"😀",publicKeySpki:"",signature:"")
        var expected = Data("plain-text-native/v1\0".utf8)
        expected.append(contentsOf:[0,0,0,2,0xc3,0xa9,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,4,0xf0,0x9f,0x98,0x80])
        XCTAssertEqual(proof.signingBytes,expected)
    }
}
