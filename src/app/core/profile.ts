import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { UpdateProfilePictureResponse, UpdateProfileRequest, UserProfileResponse } from './profile.models';

// Cliente de IdentityEndpoints.cs -- GET/PUT /api/identity/profile + POST
// /api/identity/profile/picture. Generico de plataforma (mismo backend que ya usa
// StartOtp/VerifyOtp/Register), no especifico de PreciosIQ.
@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly http = inject(HttpClient);
  private readonly profileUrl = `${environment.apiBaseUrl}identity/profile`;

  getProfile(): Observable<UserProfileResponse> {
    return this.http.get<UserProfileResponse>(this.profileUrl);
  }

  updateProfile(request: UpdateProfileRequest): Observable<UserProfileResponse> {
    return this.http.put<UserProfileResponse>(this.profileUrl, request);
  }

  uploadPicture(file: File): Observable<UpdateProfilePictureResponse> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<UpdateProfilePictureResponse>(`${this.profileUrl}/picture`, formData);
  }
}
