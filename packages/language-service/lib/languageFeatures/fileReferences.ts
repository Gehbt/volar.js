import type { NullableResult, ServiceContext } from '../types';
import { languageFeatureWorker } from '../utils/featureWorkers';
import * as dedupe from '../utils/dedupe';
import type * as vscode from 'vscode-languageserver-protocol';
import { notEmpty } from '../utils/common';
import { NoneCancellationToken } from '../utils/cancellation';

export function register(context: ServiceContext) {

	return (uri: string, token = NoneCancellationToken): NullableResult<vscode.Location[]> => {

		return languageFeatureWorker(
			context,
			uri,
			undefined,
			function* (_) {
				yield _;
			},
			async (service, document) => {

				if (token.isCancellationRequested)
					return;

				return await service.provideFileReferences?.(document, token) ?? [];
			},
			(data) => data.map(reference => {

				const [virtualFile] = context.project.fileProvider.getVirtualFile(reference.uri);

				if (!virtualFile) {
					return reference;
				}

				for (const map of context.documents.getMapsByVirtualFile(virtualFile)) {
					const range = map.toSourceRange(reference.range);
					if (range) {
						reference.uri = map.sourceFileDocument.uri;
						reference.range = range;
						return reference;
					}
				}
			}).filter(notEmpty),
			arr => dedupe.withLocations(arr.flat()),
		);
	};
}