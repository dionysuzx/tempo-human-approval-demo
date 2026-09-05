#!/usr/bin/env python3
"""Generate the Xcode project and optional verified-domain association files."""
import argparse, json, plistlib, re
from pathlib import Path
from urllib.parse import urlsplit
p=argparse.ArgumentParser()
p.add_argument('--origin', default='https://approval.invalid')
p.add_argument('--team', default='')
p.add_argument('--bundle', default='org.tempoapproval.iphone')
p.add_argument('--install-url', default='')
a=p.parse_args();u=urlsplit(a.origin)
if u.scheme!='https' or not u.hostname or u.path or u.query or u.fragment or u.username or u.password or u.port: p.error('origin must be an HTTPS origin without port, path, credentials, query or fragment')
if a.team and not re.fullmatch('[A-Z0-9]{10}',a.team): p.error('Apple team must be 10 uppercase letters/digits')
if not re.fullmatch('[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)+',a.bundle): p.error('invalid bundle ID')
if a.install_url and not re.fullmatch(r'https://(?:testflight\.apple\.com/join/[A-Za-z0-9]+|apps\.apple\.com/[A-Za-z0-9/_-]+)',a.install_url): p.error('Use an official TestFlight or App Store HTTPS URL')
root=Path(__file__).resolve().parent
(root.parent/'relay-site/public/distribution.json').write_text(json.dumps({'installURL':a.install_url or None})+'\n')
info={'CFBundleIdentifier':'$(PRODUCT_BUNDLE_IDENTIFIER)','CFBundleName':'Tempo Approval','CFBundleExecutable':'$(EXECUTABLE_NAME)','CFBundlePackageType':'APPL','CFBundleShortVersionString':'1.0','CFBundleVersion':'1','LSRequiresIPhoneOS':True,'UILaunchScreen':{},'UISupportedInterfaceOrientations':['UIInterfaceOrientationPortrait'],'NSFaceIDUsageDescription':'Approve the exact GitHub changes you reviewed with your enrolled Face ID.','ApprovalOrigin':a.origin}
(root/'TempoApproval/Info.plist').write_bytes(plistlib.dumps(info))
(root/'TempoApproval/TempoApproval.entitlements').write_bytes(plistlib.dumps({'com.apple.developer.associated-domains':['applinks:'+u.hostname]}))
files=['Approval.swift','SigningKey.swift','Delivery.swift','TempoApprovalApp.swift']
objects=[]
def oid(n):return f'{n:024X}'
def obj(n,value):objects.append(f'{oid(n)} = {{ {value} }};')
for i,name in enumerate(files):
 obj(100+i,f'isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {name}; sourceTree = "<group>";')
 obj(200+i,f'isa = PBXBuildFile; fileRef = {oid(100+i)};')
obj(1,f'isa = PBXProject; attributes = {{ LastUpgradeCheck = 1600; }}; buildConfigurationList = {oid(10)}; compatibilityVersion = "Xcode 14.0"; developmentRegion = en; mainGroup = {oid(2)}; productRefGroup = {oid(4)}; projectDirPath = ""; targets = ({oid(5)});')
obj(2,f'isa = PBXGroup; children = ({oid(3)}, {oid(4)}); sourceTree = "<group>";')
obj(3,f'isa = PBXGroup; children = ({", ".join(oid(100+i) for i in range(len(files)))}); path = TempoApproval; sourceTree = "<group>";')
obj(4,f'isa = PBXGroup; children = ({oid(6)}); name = Products; sourceTree = "<group>";')
obj(6,'isa = PBXFileReference; explicitFileType = wrapper.application; path = TempoApproval.app; sourceTree = BUILT_PRODUCTS_DIR;')
obj(5,f'isa = PBXNativeTarget; buildConfigurationList = {oid(11)}; buildPhases = ({oid(7)}, {oid(8)}, {oid(9)}); buildRules = (); dependencies = (); name = TempoApproval; productName = TempoApproval; productReference = {oid(6)}; productType = "com.apple.product-type.application";')
obj(7,f'isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ({", ".join(oid(200+i) for i in range(len(files)))}); runOnlyForDeploymentPostprocessing = 0;')
for n,isa in [(8,'PBXFrameworksBuildPhase'),(9,'PBXResourcesBuildPhase')]:obj(n,f'isa = {isa}; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;')
for n,ids in [(10,[20,21]),(11,[22,23])]:obj(n,f'isa = XCConfigurationList; buildConfigurations = ({", ".join(map(oid,ids))}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;')
for n,name in [(20,'Debug'),(21,'Release')]:obj(n,f'isa = XCBuildConfiguration; name = {name}; buildSettings = {{ SDKROOT = iphoneos; IPHONEOS_DEPLOYMENT_TARGET = 17.0; SWIFT_VERSION = 5.0; CLANG_ENABLE_MODULES = YES; }};')
for n,name in [(22,'Debug'),(23,'Release')]:obj(n,f'isa = XCBuildConfiguration; name = {name}; buildSettings = {{ PRODUCT_BUNDLE_IDENTIFIER = {a.bundle}; PRODUCT_NAME = "$(TARGET_NAME)"; INFOPLIST_FILE = TempoApproval/Info.plist; CODE_SIGN_ENTITLEMENTS = TempoApproval/TempoApproval.entitlements; CODE_SIGN_STYLE = Automatic; DEVELOPMENT_TEAM = "{a.team}"; TARGETED_DEVICE_FAMILY = 1; SWIFT_OPTIMIZATION_LEVEL = "-Onone"; }};')
project=root/'TempoApproval.xcodeproj';project.mkdir(exist_ok=True)
(project/'project.pbxproj').write_text('// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n'+'\n'.join(objects)+f'\n}}; rootObject = {oid(1)}; }}\n')
if a.team and not u.hostname.endswith('.invalid'):
 dest=root.parent/'relay-site/public/.well-known';dest.mkdir(parents=True,exist_ok=True)
 (dest/'apple-app-site-association').write_text(json.dumps({'applinks':{'details':[{'appIDs':[a.team+'.'+a.bundle],'components':[{'/':'/native','comment':'Exact approval entry only'}]}]}},indent=2)+'\n')
print('Generated Xcode project. No signing, provisioning, enrollment or deployment was performed.')
