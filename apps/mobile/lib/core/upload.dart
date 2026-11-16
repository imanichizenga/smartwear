import 'dart:io';

import 'package:dio/dio.dart';

import 'api.dart';

/// Direct-to-S3 image upload: presign → POST the file straight to the bucket (with progress) → complete
/// (the server sniffs the bytes). Returns the media JSON. Customer purposes: avatar, review, chat,
/// wholesale_licence. The bucket call uses a bare Dio so no API headers (auth) leak to storage.
Future<Json> uploadImage(Api api, File file, {required String purpose, void Function(double progress)? onProgress}) async {
  final bytes = await file.length();
  final name = file.path.split(Platform.pathSeparator).last;
  final ext = name.contains('.') ? name.split('.').last.toLowerCase() : 'jpg';
  final contentType = switch (ext) {
    'png' => 'image/png',
    'webp' => 'image/webp',
    'heic' || 'heif' => 'image/heic',
    _ => 'image/jpeg',
  };
  final p = await api.post<Json>('/media/presign', {'type': 'IMAGE', 'contentType': contentType, 'bytes': bytes, 'fileName': name, 'purpose': purpose});
  final single = p.obj('single');
  if (single == null) throw ApiException(400, 'upload_too_large', 'That photo is too large');
  final form = FormData.fromMap({
    ...Map<String, dynamic>.from(single['fields'] as Map),
    'file': await MultipartFile.fromFile(file.path, filename: name, contentType: DioMediaType.parse(contentType)),
  });
  try {
    await Dio().post<void>(single.str('url'), data: form, onSendProgress: (sent, total) {
      if (total > 0) onProgress?.call(sent / total);
    });
  } on DioException catch (e) {
    final offline = e.type == DioExceptionType.connectionError || e.error is SocketException;
    throw ApiException(0, offline ? 'offline' : 'upload_failed', offline ? 'You are offline' : 'Upload failed — please try again');
  }
  onProgress?.call(1);
  return api.post<Json>('/media/complete', {'mediaId': p.str('mediaId')});
}
